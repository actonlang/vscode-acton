import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, Executable } from 'vscode-languageclient/node';
import * as path from 'path';
import * as fs from 'fs';
import { installOrUpdate, readInstallInfo, removeManagedInstall, Channel, getRelease, ensureDisplayVersion } from './installer';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Acton');
  context.subscriptions.push(log);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'acton.showBinaryInfo';
  status.tooltip = 'Acton toolchain status';
  status.hide();
  context.subscriptions.push(status);

  function showStatus(text?: string) {
    if (text) { status.text = text; status.show(); }
    else status.hide();
  }
  function statusLabel(info: any): string | undefined {
    if (!info) return undefined;
    const ver = (info.displayVersion || info.version || '').trim();
    const showTip = info.channel === 'tip' && ver.toLowerCase() !== 'tip';
    return `Acton ${ver} (managed${showTip ? ' tip' : ''})`;
  }

  // Read settings
  const cfgInstall = vscode.workspace.getConfiguration('acton');
  const manageInstallation = cfgInstall.get<boolean>('manageInstallation', true) ?? true;
  const releaseChannel = (cfgInstall.get<string>('releaseChannel', 'latest') as Channel) ?? 'latest';
  const autoUpdate = cfgInstall.get<string>('autoUpdate', 'ask') ?? 'ask';

  // Resolve language server path
  const cfg = vscode.workspace.getConfiguration('acton.lsp');
  let serverCmd = cfg.get<string>('serverPath', 'lsp-server-acton');
  const debounceMs = cfg.get<number>('debounce', 200);
  if (!path.isAbsolute(serverCmd) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const localServer = path.join(wsRoot, 'dist', 'bin', 'lsp-server-acton');
    if (fs.existsSync(localServer)) serverCmd = localServer;
  }

  // Managed install handling
  let managed = readInstallInfo(context.globalStorageUri);
  if (managed) {
    ensureDisplayVersion(context, managed).then(updated => {
      managed = updated;
      const lbl = statusLabel(managed);
      if (lbl) showStatus(lbl);
    }).catch(() => {});
  }

  function which(cmd: string): string | undefined {
    const envPath = (process.env.PATH || '').split(path.delimiter);
    for (const d of envPath) {
      const c = path.join(d, cmd);
      try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch {}
    }
    return undefined;
  }

  // If nothing found and allowed, offer managed install
  if (manageInstallation && !managed && !which('acton')) {
    vscode.window.showInformationMessage('Acton not found in PATH. Install a managed Acton toolchain?', 'Install latest', 'Install tip', 'Skip').then(async sel => {
      try {
        if (sel === 'Install latest') {
          managed = await installOrUpdate(context, 'latest');
          const lbl = statusLabel(managed);
          if (lbl) showStatus(lbl);
        } else if (sel === 'Install tip') {
          managed = await installOrUpdate(context, 'tip');
          const lbl = statusLabel(managed);
          if (lbl) showStatus(lbl);
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Acton install failed: ${e?.message || e}`);
      }
    });
  }

  // If managed and default server path, use managed LSP
  const isDefaultServerPath = (p: string | undefined) => !p || p === 'lsp-server-acton';
  if (managed && manageInstallation) {
    const lbl0 = statusLabel(managed);
    if (lbl0) showStatus(lbl0);
    if (isDefaultServerPath(serverCmd) && managed.lspPath) serverCmd = managed.lspPath;
    // One-time update check on startup
    const chan = managed.channel || releaseChannel;
    getRelease(chan).then(r => {
      const remoteVer = r.tag_name.replace(/^v/, '');
      if (remoteVer && remoteVer !== managed?.version) {
        if (autoUpdate === 'auto') {
          installOrUpdate(context, chan).then(async info => {
            managed = info;
            const lbl = statusLabel(info);
            if (lbl) showStatus(lbl);
            vscode.window.showInformationMessage(`Updated Acton to ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
          }).catch(e => vscode.window.showErrorMessage(`Acton auto-update failed: ${e?.message || e}`));
        } else if (autoUpdate === 'ask') {
          const rem = remoteVer.toLowerCase() === 'tip' ? 'tip' : remoteVer;
          vscode.window.showInformationMessage(`Acton ${rem} is available. Update now?`, 'Update', 'Later').then(sel => {
            if (sel === 'Update') {
              installOrUpdate(context, chan).then(async info => {
                managed = info;
                const lbl = statusLabel(info);
                if (lbl) showStatus(lbl);
                vscode.window.showInformationMessage(`Updated Acton to ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
              }).catch(e => vscode.window.showErrorMessage(`Acton update failed: ${e?.message || e}`));
            }
          });
        }
      }
    }).catch(() => {});
  } else {
    showStatus(undefined);
  }

  // Start language client
  const serverExecutable: Executable = { command: serverCmd, args: [] };
  const serverOptions: ServerOptions = { run: serverExecutable, debug: serverExecutable };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'acton' }],
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.act') },
    initializationOptions: { debounceMs }
  };
  client = new LanguageClient('actonLanguageServer', 'Acton Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client);
  client.start();

  // Commands for managed installation
  context.subscriptions.push(vscode.commands.registerCommand('acton.installOrUpdate', async () => {
    try {
      const pick = await vscode.window.showQuickPick([
        { label: 'Latest (stable)', value: 'latest' },
        { label: 'Tip (prerelease)', value: 'tip' }
      ], { title: 'Install Acton release channel' });
      if (!pick) return;
      const info = await installOrUpdate(context, pick.value as Channel);
      managed = info;
      const lbl = statusLabel(info);
      if (lbl) showStatus(lbl);
      vscode.window.showInformationMessage(`Installed Acton ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Acton install/update failed: ${e?.message || e}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('acton.useSystemBinary', async () => {
    try {
      const confLsp = vscode.workspace.getConfiguration('acton.lsp');
      await confLsp.update('serverPath', 'lsp-server-acton', vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('Configured to use system Acton language server (lsp-server-acton).');
      showStatus(undefined);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to switch to system binary: ${e?.message || e}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('acton.showBinaryInfo', async () => {
    const lines: string[] = [];
    lines.push('Acton — Managed Binary Info');
    lines.push('');
    lines.push(`Managed install: ${managed ? 'present' : 'none'}`);
    if (managed) {
      const ver = managed.displayVersion || managed.version;
      const suffix = managed.channel === 'tip' && (ver || '').toLowerCase() !== 'tip' ? ' (tip)' : '';
      lines.push(`version:`);
      lines.push(`  ${ver}${suffix}`);
      lines.push('installDir:');
      lines.push(`  ${managed.installDir}`);
      lines.push('actonPath:');
      lines.push(`  ${managed.actonPath}`);
      if (managed.lspPath) {
        lines.push('lspPath:');
        lines.push(`  ${managed.lspPath}`);
      }
    }
    log.clear();
    log.appendLine(lines.join('\n'));
    log.show(true);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('acton.removeManagedBinary', async () => {
    const ok = await vscode.window.showWarningMessage('Remove managed Acton installation?', { modal: true }, 'Remove');
    if (ok !== 'Remove') return;
    try {
      await removeManagedInstall(context.globalStorageUri);
      managed = undefined;
      showStatus(undefined);
      vscode.window.showInformationMessage('Removed managed Acton installation.');
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to remove managed install: ${e?.message || e}`);
    }
  }));
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

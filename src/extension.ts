import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, Executable } from 'vscode-languageclient/node';
import * as path from 'path';
import * as fs from 'fs';
import { installOrUpdate, readInstallInfo, removeManagedInstall, Channel, getRelease, ensureDisplayVersion, computeRemoteBuildId } from './installer';
import { detectPlatform } from './platform';
import * as os from 'os';
import { spawn } from 'child_process';

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
      const remoteVer = chan === 'tip'
        ? (computeRemoteBuildId(r, 'tip', detectPlatform() || undefined) || 'tip')
        : r.tag_name.replace(/^v/, '');
      const localVer = chan === 'tip' ? (managed?.buildId || managed?.displayVersion || managed?.version) : managed?.version;
      if (remoteVer && localVer && remoteVer !== localVer) {
        if (autoUpdate === 'auto') {
          installOrUpdate(context, chan).then(async info => {
            managed = info;
            const lbl = statusLabel(info);
            if (lbl) showStatus(lbl);
            vscode.window.showInformationMessage(`Updated Acton to ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
          }).catch(e => vscode.window.showErrorMessage(`Acton auto-update failed: ${e?.message || e}`));
        } else if (autoUpdate === 'ask') {
          const rem = chan === 'tip' && remoteVer.toLowerCase() !== 'tip' ? `${remoteVer} (tip)` : remoteVer;
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

  // Re-check daily (useful for tip and latest)
  try {
    const msDay = 24 * 60 * 60 * 1000;
    const timer = setInterval(() => {
      try {
        if (!manageInstallation || !managed) return;
        const chan = managed.channel || releaseChannel;
        getRelease(chan).then(r => {
          const remoteVer = chan === 'tip'
            ? (computeRemoteBuildId(r, 'tip', detectPlatform() || undefined) || 'tip')
            : r.tag_name.replace(/^v/, '');
          const localVer = chan === 'tip' ? (managed?.buildId || managed?.displayVersion || managed?.version) : managed?.version;
          if (remoteVer && localVer && remoteVer !== localVer) {
            if (autoUpdate === 'auto') {
              installOrUpdate(context, chan).then(async info => {
                managed = info;
                const lbl = statusLabel(info);
                if (lbl) showStatus(lbl);
              }).catch(() => {});
            } else if (autoUpdate === 'ask') {
              const rem = chan === 'tip' && remoteVer.toLowerCase() !== 'tip' ? `${remoteVer} (tip)` : remoteVer;
              vscode.window.showInformationMessage(`Acton ${rem} is available. Update now?`, 'Update', 'Later').then(sel => {
                if (sel === 'Update') vscode.commands.executeCommand('acton.installOrUpdate');
              });
            }
          }
        }).catch(() => {});
      } catch {}
    }, msDay);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  } catch {}

  // -------- Build / Run Active File --------
  function findProjectRoot(startPath?: string): string | undefined {
    try {
      let dir = startPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!dir) return undefined;
      let prev = '';
      while (dir !== prev) {
        const candidates = ['Acton.toml'];
        for (const f of candidates) {
          try { if (fs.statSync(path.join(dir, f)).isFile()) return dir; } catch {}
        }
        prev = dir;
        dir = path.dirname(dir);
      }
    } catch {}
    return undefined;
  }

  function moduleNameFromFile(root: string, filePath: string): string | undefined {
    const rel = path.relative(root, filePath);
    const parts = rel.split(path.sep);
    const idx = parts.indexOf('src');
    if (idx >= 0 && idx + 1 < parts.length) {
      const sub = parts.slice(idx + 1).join('/');
      const baseNoExt = sub.replace(/\.act$/i, '');
      return baseNoExt.replace(/\//g, '.');
    }
    return undefined;
  }

  function computeProgramForEditor(wsRoot?: string): { program?: string; cwd?: string } {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== 'acton') return {};
    const filePath = ed.document.fileName;
    const root = findProjectRoot(path.dirname(filePath)) || wsRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = root || path.dirname(filePath);
    if (root) {
      const mod = moduleNameFromFile(root, filePath);
      if (mod) return { program: path.join(root, 'out', 'bin', mod), cwd };
    }
    // Fallback: binary next to source without extension
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    return { program: path.join(dir, base), cwd };
  }

  function getActonCmd(): string {
    const toolsCfg = vscode.workspace.getConfiguration('acton.tools');
    const p = toolsCfg.get<string>('actonPath', 'acton');
    if ((!p || p === 'acton') && manageInstallation && managed?.actonPath) return managed.actonPath;
    return p || 'acton';
  }

  async function buildActiveFile(): Promise<boolean> {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== 'acton') {
      vscode.window.showErrorMessage('Open an Acton (.act) file first.');
      return false;
    }
    const actonCmd = getActonCmd();
    const file = ed.document.fileName;
    const cwd = findProjectRoot(path.dirname(file)) || path.dirname(file);
    const out = log;
    out.clear();
    out.appendLine(`$ ${actonCmd} "${file}"`);
    out.show(true);
    return new Promise((resolve) => {
      const proc = spawn(actonCmd, [file], { cwd });
      proc.stdout.on('data', d => out.append(d.toString()));
      proc.stderr.on('data', d => out.append(d.toString()));
      proc.on('close', (code) => {
        if (code === 0) out.appendLine('Build succeeded.');
        else out.appendLine(`Build failed with exit code ${code}.`);
        resolve(code === 0);
      });
      proc.on('error', (e) => {
        out.appendLine(`Failed to spawn '${actonCmd}': ${e}`);
        resolve(false);
      });
    });
  }

  async function runActiveFile(): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== 'acton') {
      vscode.window.showErrorMessage('Open an Acton (.act) file first.');
      return;
    }
    const ok = await buildActiveFile();
    if (!ok) return;
    const def = computeProgramForEditor();
    if (!def.program) {
      vscode.window.showErrorMessage('Could not determine program path for this .act file (is it under src/?).');
      return;
    }
    const term = vscode.window.createTerminal({ name: 'Acton Run' });
    term.show(true);
    const quoted = def.program.includes(' ') ? `"${def.program}"` : def.program;
    if (def.cwd) term.sendText(`cd ${def.cwd.replace(/\s/g, '\\ ')}`);
    term.sendText(quoted);
  }

  context.subscriptions.push(vscode.commands.registerCommand('acton.buildActiveFile', buildActiveFile));
  context.subscriptions.push(vscode.commands.registerCommand('acton.runActiveFile', runActiveFile));

  // -------- Debug (Run) integration via a delegating 'acton' type --------
  function resolveActonBinaryPath(): string | undefined {
    try {
      const cmd = getActonCmd();
      if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : undefined;
      const found = which(cmd) || which('acton');
      if (found) return found;
    } catch {}
    return undefined;
  }

  function findLldbPluginRelativeToActon(): string | undefined {
    const actonBin = resolveActonBinaryPath();
    if (!actonBin) return undefined;
    try {
      const binDir = path.dirname(actonBin);
      const distRoot = path.dirname(binDir);
      const candidate = path.join(distRoot, 'lldb', 'acton.py');
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
    return undefined;
  }


  const actonDebugProvider: vscode.DebugConfigurationProvider = {
    provideDebugConfigurations(folder, _token) {
      const wsRoot = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const def = computeProgramForEditor(wsRoot);
      const cfg: vscode.DebugConfiguration = {
        name: 'Acton',
        type: 'acton',
        request: 'launch',
        program: def.program,
        cwd: def.cwd || wsRoot
      };
      log.appendLine('[run] provideDebugConfigurations for Acton');
      return [cfg];
    },
    async resolveDebugConfiguration(folder, config, _token) {
      // We delegate to lldb-dap after ensuring build and program path
      log.appendLine(`[run] resolveDebugConfiguration (noDebug=${!!config?.noDebug})`);
      log.show(true);
      const ok = await buildActiveFile();
      if (!ok) return undefined;
      const wsRoot = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const def = computeProgramForEditor(wsRoot);
      if (!def.program) {
        vscode.window.showErrorMessage('Could not determine program path for this .act file.');
        return undefined;
      }
      const initCommands: string[] = [];
      const pluginPath = findLldbPluginRelativeToActon();
      if (pluginPath) {
        log.appendLine(`[debug] Importing Acton LLDB plugin: ${pluginPath}`);
        initCommands.push(`command script import "${pluginPath}"`);
        initCommands.push('type category enable Acton');
      } else {
        log.appendLine('[debug] Acton LLDB plugin not found relative to acton binary');
      }

      const lldbCfg: vscode.DebugConfiguration = {
        name: 'Acton',
        type: 'lldb-dap',
        request: 'launch',
        program: def.program,
        cwd: def.cwd || wsRoot,
        console: 'integratedTerminal',
        internalConsoleOptions: 'neverOpen',
        noDebug: !!config?.noDebug,
        initCommands
      };
      await vscode.debug.startDebugging(folder, lldbCfg);
      // Cancel the original 'acton' debug session
      return undefined;
    }
  };
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('acton', actonDebugProvider));

  // Start language client
  const serverExecutable: Executable = { command: serverCmd, args: [] };
  const serverOptions: ServerOptions = { run: serverExecutable, debug: serverExecutable };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'acton' }],
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

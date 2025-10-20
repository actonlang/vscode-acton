import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, Executable } from 'vscode-languageclient/node';
import * as path from 'path';
import * as fs from 'fs';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('acton.lsp');
  let serverCmd = cfg.get<string>('serverPath', 'lsp-server-acton');

  if (!path.isAbsolute(serverCmd) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const localServer = path.join(wsRoot, 'dist', 'bin', 'lsp-server-acton');
    if (fs.existsSync(localServer)) serverCmd = localServer;
  }

  const serverExecutable: Executable = { command: serverCmd, args: [] };
  const serverOptions: ServerOptions = { run: serverExecutable, debug: serverExecutable };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'acton' }],
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.act') }
  };

  client = new LanguageClient('actonLanguageServer', 'Acton Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client);
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}


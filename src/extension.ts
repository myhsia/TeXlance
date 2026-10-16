import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
  TransportKind,
} from 'vscode-languageclient/node';
import { RefreshIndexRequest, StatusNotification } from '@texlance/core';
import type { RefreshedIndex, StatusParams } from '@texlance/core';

let client: LanguageClient | undefined;
let statusItem: vscode.StatusBarItem | undefined;

function updateStatus(params: StatusParams): void {
  if (!statusItem) {
    return;
  }
  const counts = `${params.packages} packages · ${params.classes} classes`;
  switch (params.state) {
    case 'indexing':
      statusItem.text = '$(sync~spin) TeXlance';
      statusItem.tooltip = 'TeXlance: indexing packages…';
      break;
    case 'error':
      statusItem.text = '$(warning) TeXlance';
      statusItem.tooltip = `TeXlance: ${params.message ?? 'error'}`;
      break;
    default:
      statusItem.text = '$(symbol-misc) TeXlance';
      statusItem.tooltip = `TeXlance: ${counts}\n${
        params.kpsewhich ? `kpsewhich: ${params.kpsewhich}` : 'kpsewhich: not found'
      }`;
      break;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6010'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'latex' },
      { scheme: 'file', language: 'tex' },
      // Also pick up TeX documents when no extension contributes a `latex`
      // language id, so TeXlance works standalone.
      { scheme: 'file', pattern: '**/*.{tex,ltx,sty,cls}' },
    ],
    synchronize: { configurationSection: 'texlance' },
    outputChannelName: 'TeXlance',
  };

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusItem.name = 'TeXlance';
  statusItem.command = 'texlance.showOutput';
  statusItem.text = '$(sync~spin) TeXlance';
  statusItem.tooltip = 'TeXlance: starting language server…';
  statusItem.show();

  client = new LanguageClient('texlance', 'TeXlance', serverOptions, clientOptions);
  client.onNotification(StatusNotification, (params: StatusParams) => updateStatus(params));
  client.onDidChangeState((event) => {
    if (event.newState === State.Stopped && statusItem) {
      statusItem.text = '$(circle-slash) TeXlance';
      statusItem.tooltip = 'TeXlance: language server stopped';
    }
  });

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('texlance.refreshPackageIndex', async () => {
      if (!client) {
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'TeXlance: refreshing package index…' },
        async () => {
          const result = (await client?.sendRequest(RefreshIndexRequest)) as RefreshedIndex | undefined;
          if (result) {
            void vscode.window.showInformationMessage(
              `TeXlance: indexed ${result.packages} packages and ${result.classes} classes.`,
            );
          }
        },
      );
    }),
    vscode.commands.registerCommand('texlance.showOutput', () => client?.outputChannel.show(true)),
    vscode.commands.registerCommand('texlance.restartServer', async () => {
      await client?.restart();
    }),
  );

  await client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

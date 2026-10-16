import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'myhsia.texlance';

function workspaceFile(relativePath: string): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'the integration workspace must contain a folder');
  return vscode.Uri.joinPath(folders[0].uri, relativePath);
}

async function open(relativePath: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(workspaceFile(relativePath));
  await vscode.window.showTextDocument(document, { preview: false });
  return document;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number, description: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await delay(150);
  }
}

/** Resolves once the language server publishes diagnostics for `uri` at least once. */
function waitForDiagnosticsPublished(uri: vscode.Uri, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let subscription: vscode.Disposable | undefined;
    const finish = (): void => {
      subscription?.dispose();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      subscription?.dispose();
      reject(new Error(`timed out waiting for diagnostics of ${uri.toString()}`));
    }, timeoutMs);
    subscription = vscode.languages.onDidChangeDiagnostics((event) => {
      if (event.uris.some((changed) => changed.toString() === uri.toString())) {
        finish();
      }
    });
  });
}

function completionLabels(list: vscode.CompletionList | undefined): string[] {
  return (list?.items ?? []).map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
}

suite('TeXlance', () => {
  suiteSetup(async function () {
    this.timeout(240_000);
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} should be installed`);
    await extension.activate();
    // The command resolves only after the language server finished indexing,
    // which makes the assertions below deterministic.
    await vscode.commands.executeCommand('texlance.refreshPackageIndex');
  });

  test('reports an unresolved package with the Pylance-style diagnostic', async () => {
    const document = await open('missing.tex');
    const diagnostics = await waitFor(
      () => {
        const found = vscode.languages.getDiagnostics(document.uri);
        return found.length > 0 ? found : null;
      },
      30_000,
      'diagnostics for missing.tex',
    );

    assert.strictEqual(diagnostics.length, 1, `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
    const [diagnostic] = diagnostics;
    assert.strictEqual(diagnostic.message, 'Load the "missingpkg" package could not be resolved');
    assert.strictEqual(diagnostic.source, 'TeXlance');
    assert.strictEqual(diagnostic.code, 'reportMissingPackages');
    assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(document.getText(diagnostic.range), 'missingpkg');
  });

  test('stays silent when the class and packages resolve', async () => {
    const document = await open('resolved.tex');
    await waitForDiagnosticsPublished(document.uri, 30_000);
    await delay(1_000);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri), []);
  });

  test('completes package names discovered through an extra path', async () => {
    const document = await open('completion.tex');
    const position = new vscode.Position(1, '\\usepackage{localp'.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      position,
    );
    assert.ok(
      completionLabels(list).includes('localpkg'),
      `expected "localpkg" among ${JSON.stringify(completionLabels(list))}`,
    );
  });

  test('completes preamble commands with a snippet', async () => {
    const document = await open('commands.tex');
    const position = new vscode.Position(0, '\\usepac'.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      position,
    );
    const item = (list?.items ?? []).find(
      (entry) => (typeof entry.label === 'string' ? entry.label : entry.label.label) === '\\usepackage',
    );
    assert.ok(item, `expected a \\usepackage completion among ${JSON.stringify(completionLabels(list))}`);
    assert.ok(item.insertText instanceof vscode.SnippetString, 'the command completion should insert a snippet');
    assert.strictEqual(item.insertText.value, '\\usepackage{${1}}');
  });
});

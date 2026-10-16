import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  MarkupKind,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  TextDocuments,
} from 'vscode-languageserver/node';
import type {
  CompletionItem,
  CompletionParams,
  DidChangeWatchedFilesParams,
  InitializeParams,
  InitializeResult,
  WorkspaceFoldersChangeEvent,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  IndexDb,
  Kpse,
  RefreshIndexRequest,
  Resolver,
  SEARCH_EXTENSIONS,
  StatusNotification,
  buildCompletionItems,
  buildDiagnostics,
  getCompletionContext,
  parsePreamble,
  severityFromString,
  walkFileNames,
} from '@texlance/core';
import type { RefreshedIndex, ResolutionCompletionData, StatusParams } from '@texlance/core';
import { type TexlanceSettings, normalizeSettings } from './settings';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const VALIDATION_DELAY_MS = 300;
const INDEX_REBUILD_DELAY_MS = 1500;

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let workspaceFolderPaths: string[] = [];

let index = new IndexDb();
let kpse: Kpse | null = null;
let configuredExecutable: string | null = null;
/** Resolves once kpsewhich discovery finished; validation waits on it. */
let kpseReady: Promise<void> = Promise.resolve();

const documentSettings = new Map<string, Promise<TexlanceSettings>>();
const resolvers = new Map<string, Resolver>();
const validated = new Set<string>();
const pendingValidation = new Map<string, NodeJS.Timeout>();
let pendingIndexRebuild: NodeJS.Timeout | null = null;

function uriToPath(uri: string): string | null {
  if (uri.length === 0 || !uri.startsWith('file:')) {
    return null;
  }
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

function folderFor(uri: string): string | null {
  const filePath = uriToPath(uri);
  if (filePath) {
    let best: string | null = null;
    for (const folder of workspaceFolderPaths) {
      if ((filePath === folder || filePath.startsWith(folder + path.sep)) && (!best || folder.length > best.length)) {
        best = folder;
      }
    }
    if (best) {
      return best;
    }
  }
  return workspaceFolderPaths[0] ?? null;
}

function getDocumentSettings(resourceUri: string): Promise<TexlanceSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(normalizeSettings(undefined, folderFor(resourceUri)));
  }
  let result = documentSettings.get(resourceUri);
  if (!result) {
    result = connection.workspace
      .getConfiguration({ scopeUri: resourceUri || undefined, section: 'texlance' })
      .then((raw) => normalizeSettings(raw, folderFor(resourceUri)));
    documentSettings.set(resourceUri, result);
  }
  return result;
}

function getResolver(documentUri: string, settings: TexlanceSettings): Resolver {
  const filePath = uriToPath(documentUri);
  const documentDirectory = filePath ? path.dirname(filePath) : '';
  const key = `${documentDirectory}\u0000${settings.extraPaths.join('\u0000')}`;
  let resolver = resolvers.get(key);
  if (!resolver) {
    resolver = new Resolver({
      kpse,
      documentDirectory,
      extraPaths: settings.extraPaths,
      workspaceFolders: workspaceFolderPaths,
    });
    resolvers.set(key, resolver);
  }
  return resolver;
}

function sendStatus(partial: Partial<StatusParams> & Pick<StatusParams, 'state'>): void {
  const params: StatusParams = {
    state: partial.state,
    packages: index.packageCount,
    classes: index.classCount,
    kpsewhich: kpse?.executable ?? null,
    ...(partial.message !== undefined ? { message: partial.message } : {}),
  };
  void connection.sendNotification(StatusNotification, params);
}

async function validateDocument(document: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(document.uri);
  if (settings.reportMissingPackages === 'none') {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  // Never report a package as missing before kpsewhich has been located,
  // otherwise installed packages would briefly show as unresolved.
  await kpseReady;

  try {
    const { refs } = parsePreamble(document, settings.maxPreambleLines);
    const resolver = getResolver(document.uri, settings);
    const resolution = await resolver.resolveRefs(refs);
    const diagnostics = buildDiagnostics(refs, resolution, severityFromString(settings.reportMissingPackages));
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
  } catch (error) {
    connection.console.error(`TeXlance: failed to validate ${document.uri}: ${String(error)}`);
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  }
}

function scheduleValidation(document: TextDocument, immediate: boolean): void {
  const key = document.uri;
  const existing = pendingValidation.get(key);
  if (existing) {
    clearTimeout(existing);
    pendingValidation.delete(key);
  }
  if (immediate) {
    void validateDocument(document);
    return;
  }
  const timer = setTimeout(() => {
    pendingValidation.delete(key);
    const current = documents.get(key);
    if (current) {
      void validateDocument(current);
    }
  }, VALIDATION_DELAY_MS);
  pendingValidation.set(key, timer);
}

function revalidateAll(): void {
  for (const document of documents.all()) {
    void validateDocument(document);
  }
}

async function initializeKpse(executable: string | null): Promise<void> {
  configuredExecutable = executable;
  const discovered = await Kpse.discover({ executable, env: process.env });
  kpse = discovered;
  resolvers.clear();

  if (discovered) {
    connection.console.info(`TeXlance: using kpsewhich at ${discovered.executable}`);
    return;
  }

  const message =
    'TeXlance could not find "kpsewhich". Installed LaTeX packages will not be resolved. ' +
    'Set "texlance.kpsewhichPath" to the kpsewhich executable.';
  connection.console.warn(message);
  void connection.window.showWarningMessage(message);
}

function startKpseDiscovery(executable: string | null): Promise<void> {
  const pending = initializeKpse(executable).catch((error) => {
    connection.console.error(`TeXlance: failed to initialise kpsewhich: ${String(error)}`);
  });
  kpseReady = pending;
  return pending;
}

async function rebuildIndex(): Promise<void> {
  sendStatus({ state: 'indexing' });

  const nextIndex = new IndexDb();

  if (kpse) {
    const roots = await kpse.texmfRoots();
    for (const root of roots) {
      try {
        nextIndex.addFromLsR(await fs.readFile(path.join(root, 'ls-R'), 'utf8'));
      } catch {
        // Tree has no ls-R database; kpsewhich still resolves it at check time.
      }
    }
  }

  const directories = new Set<string>();
  for (const folder of workspaceFolderPaths) {
    directories.add(folder);
    const settings = await getDocumentSettings(pathToFileURL(folder).toString());
    for (const extraPath of settings.extraPaths) {
      directories.add(extraPath);
    }
  }

  try {
    nextIndex.addEntries(walkFileNames([...directories], { extensions: SEARCH_EXTENSIONS, maxDepth: 5 }).keys());
  } catch (error) {
    connection.console.warn(`TeXlance: failed to scan directories: ${String(error)}`);
  }

  index = nextIndex;
  resolvers.clear();

  connection.console.info(
    `TeXlance: indexed ${index.packageCount} packages and ${index.classCount} classes`,
  );
  sendStatus({ state: 'ready' });
  revalidateAll();
}

function scheduleIndexRebuild(): void {
  if (pendingIndexRebuild) {
    clearTimeout(pendingIndexRebuild);
  }
  pendingIndexRebuild = setTimeout(() => {
    pendingIndexRebuild = null;
    void rebuildIndex();
  }, INDEX_REBUILD_DELAY_MS);
}

function handleWorkspaceFoldersChanged(event: WorkspaceFoldersChangeEvent): void {
  const removed = new Set(
    event.removed.map((folder) => uriToPath(folder.uri)).filter((folder): folder is string => Boolean(folder)),
  );
  workspaceFolderPaths = workspaceFolderPaths.filter((folder) => !removed.has(folder));
  for (const folder of event.added) {
    const folderPath = uriToPath(folder.uri);
    if (folderPath && !workspaceFolderPaths.includes(folderPath)) {
      workspaceFolderPaths.push(folderPath);
    }
  }
  documentSettings.clear();
  resolvers.clear();
  void rebuildIndex();
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = Boolean(params.capabilities.workspace?.configuration);
  hasWorkspaceFolderCapability = Boolean(params.capabilities.workspace?.workspaceFolders);

  workspaceFolderPaths = (params.workspaceFolders ?? [])
    .map((folder) => uriToPath(folder.uri))
    .filter((folder): folder is string => Boolean(folder));

  if (workspaceFolderPaths.length === 0 && params.rootUri) {
    const root = uriToPath(params.rootUri);
    if (root) {
      workspaceFolderPaths = [root];
    }
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['{', ',', '\\'],
      },
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      },
    },
  };
});

connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  void connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: [{ globPattern: '**/*.{sty,cls}' }],
  });

  const rootUri = workspaceFolderPaths[0] ? pathToFileURL(workspaceFolderPaths[0]).toString() : '';
  const settings = await getDocumentSettings(rootUri);
  await startKpseDiscovery(settings.kpsewhichPath);

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(handleWorkspaceFoldersChanged);
  }

  await rebuildIndex();
});

connection.onDidChangeConfiguration(async () => {
  documentSettings.clear();
  resolvers.clear();
  const rootUri = workspaceFolderPaths[0] ? pathToFileURL(workspaceFolderPaths[0]).toString() : '';
  const settings = await getDocumentSettings(rootUri);
  if (settings.kpsewhichPath !== configuredExecutable) {
    await startKpseDiscovery(settings.kpsewhichPath);
  }
  await rebuildIndex();
});

connection.onDidChangeWatchedFiles((_params: DidChangeWatchedFilesParams) => {
  resolvers.clear();
  scheduleIndexRebuild();
});

connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  const settings = await getDocumentSettings(document.uri);
  if (!settings.completionEnabled) {
    return [];
  }
  const context = getCompletionContext(document, params.position);
  return buildCompletionItems(context, index, document.uri);
});

connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {
  const data = item.data as ResolutionCompletionData | undefined;
  if (!data || typeof data.name !== 'string' || typeof data.uri !== 'string') {
    return item;
  }

  const settings = await getDocumentSettings(data.uri);
  const resolver = getResolver(data.uri, settings);
  try {
    const resolution = await resolver.resolveName(data.name, data.resourceKind);
    if (resolution) {
      item.detail = `${item.detail ?? ''} (${resolution.origin})`.trim();
      item.documentation = { kind: MarkupKind.Markdown, value: `Resolved to \`${resolution.path}\`` };
    } else {
      item.detail = `${item.detail ?? ''} (unresolved)`.trim();
      item.documentation = {
        kind: MarkupKind.Markdown,
        value: `Not found by kpsewhich, an extra path, or the workspace.`,
      };
    }
  } catch {
    // Leave the item untouched if resolution fails.
  }
  return item;
});

connection.onRequest(RefreshIndexRequest, async (): Promise<RefreshedIndex> => {
  await rebuildIndex();
  return { packages: index.packageCount, classes: index.classCount };
});

documents.onDidOpen((event) => {
  validated.add(event.document.uri);
  void validateDocument(event.document);
});

documents.onDidChangeContent((change) => {
  const immediate = !validated.has(change.document.uri);
  validated.add(change.document.uri);
  scheduleValidation(change.document, immediate);
});

documents.onDidClose((event) => {
  validated.delete(event.document.uri);
  const timer = pendingValidation.get(event.document.uri);
  if (timer) {
    clearTimeout(timer);
    pendingValidation.delete(event.document.uri);
  }
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();

---
name: TeXlance Development
description: Build, test and debug the TeXlance extension and language server — workspaces, esbuild bundling, Vitest unit tests, @vscode/test-electron integration tests, fixtures, and driving the LSP server over stdio without VS Code.
---

# TeXlance Development

## When to use

Any change to parsing, resolution, diagnostics, completions, settings or the
LSP wiring.

## Workflow

1. `npm install` (workspaces: `core`, `server`).
2. Change the right layer: pure logic → `core/src/*`; LSP handlers →
   `server/src/server.ts`; extension host → `src/extension.ts`.
3. `npm run typecheck && npm run test:unit`.
4. For end-to-end changes: `npm run build && npm run test:integration`.
5. Add a unit test for every behaviour change.

## Driving the server without VS Code

The bundled server refuses to start without an explicit transport flag:

```sh
node dist/server.js --stdio
```

VS Code's `TransportKind.ipc` passes `--node-ipc` automatically. Framing is
`Content-Length: N\r\n\r\n<json>`. `textDocument/completion` may return either a
bare `CompletionItem[]` or a `CompletionList` — handle both.

Server→client requests must be answered while scripting (`workspace/configuration`,
`client/registerCapability`), otherwise `initialize` times out.

## Fixtures

`test/fixtures/latex-workspace/` is the integration workspace; its
`.vscode/settings.json` sets `texlance.analysis.extraPaths: ["../extra"]`, and
`test/fixtures/extra/localpkg.sty` is the resolvable package. Integration tests
stay deterministic by relying on the document folder and extra paths instead of
an installed TeX.

## Gotchas

- Never assume TeX is installed (CI has none).
- `Kpse.candidates()` must join with the *requested* platform's rules
  (`path.posix`/`path.win32`), not the host's — Windows CI caught this.
- `connection.workspace.onDidChangeWorkspaceFolders` is a getter that throws
  before `initialize`; register it inside `onInitialized`.
- Validate only after kpsewhich discovery resolves (`kpseReady`), or installed
  packages briefly flash as unresolved.
- Vitest config is `vitest.config.mts` (ESM) to avoid Vite's CJS warning.
- `test.tex` and `*.vsix` in the repo root are local scratch output; keep them
  out of commits and out of the VSIX.

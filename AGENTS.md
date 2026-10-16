# TeXlance

VS Code extension + language server that checks LaTeX preambles against
`kpsewhich` (Pylance-style `reportMissingPackages`) and completes package and
class names.

## Layout

npm workspaces monorepo; the repo root is also the extension manifest.

| Path | What it is |
|---|---|
| `core/` | `@texlance/core` — editor-agnostic logic. Must not import `vscode`. |
| `server/` | `texlance-server` — LSP server (diagnostics, completions). |
| `src/` | VS Code client (LanguageClient, status bar, commands). |
| `test/unit/` | Vitest tests for `core`; no TeX or VS Code required. |
| `test/integration/` | `@vscode/test-electron` suites and fixtures. |
| `dist/` | esbuild output — generated, never edit by hand. |

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install the workspaces (`core`, `server`) |
| `npm run build` | Bundle `dist/extension.js` + `dist/server.js` |
| `npm run build:all` | Bundles + integration-test bundles |
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | `tsc --noEmit` for core, server and client |
| `npm run test:unit` | Vitest (fast, no TeX needed) |
| `npm run test:integration` | Real VS Code; builds first |
| `npm test` | typecheck + unit |
| `npm run package` | Produce `texlance-<version>.vsix` |

## Verification requirements

- Run `npm run typecheck` and `npm run test:unit` after touching `core/`,
  `server/` or `src/`.
- Behaviour changes to parsing, resolution, diagnostics or completions need a
  unit test in `test/unit/`. Shared fixtures live in `test/fixtures/`.
- Never assert on a real TeX installation in unit or integration tests; CI has
  no TeX. Resolve via the document folder, extra paths or a stubbed runner.

## Conventions

- TypeScript, `strict`, `module: node16`; target Node 20. `engines.vscode` is
  `^1.91.0`, dictated by `vscode-languageclient@10`.
- Keep `core/` free of `vscode` so it stays unit-testable from plain Node.
- Batch external processes: resolve every package of a document in **one**
  `kpsewhich` invocation, never one process per package.
- Diagnostics keep `source: "TeXlance"` and code `reportMissingPackages`; the
  message is `Load the "x" package|class could not be resolved`.
- Do not bump `version` outside the release workflow.

## Keeping this file and the skills current

Whenever you are asked to change anything in this project, first decide whether
this file or a skill under `.opencode/skills/` must change as well, and make
that edit in the same change:

- New or changed npm script, build step or test command → update **Commands**.
- New setting, command, diagnostic code or LSP capability → update
  **Conventions** and the matching skill.
- Anything touching versioning, tagging, packaging or publishing → update the
  `texlance-release` skill.
- A gotcha that cost real debugging time (a CI-only failure, a publishing
  quirk) → record it under the relevant skill's **Gotchas**.

Say so explicitly when no update is needed.

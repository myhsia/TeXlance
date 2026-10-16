# TeXlance

Pylance-style intelligence for LaTeX preambles in VS Code.

TeXlance reads your preamble and tells you whether the packages you asked for
actually exist, resolving each name against your TeX installation
(`kpsewhich`), your own extra search paths and the current workspace — then it
helps you type those names in the first place.

> TeXlance is a language server: a thin VS Code client (`src/`) talks to a
> server (`server/`) over LSP, and both share the editor-agnostic logic in
> `core/`.

## Features

### `reportMissingPackages` diagnostics

Commands are checked against the document folder, your extra paths, the
workspace and finally `kpsewhich` (which is what `pdflatex` itself uses):

```tex
\documentclass{article}
\usepackage{amsmath, definitivamente-no-existe}
```

```
warning  Load the "definitivamente-no-existe" package could not be resolved
         TeXlance(reportMissingPackages)
```

* `\usepackage{a, b, c}` accepts a list and every entry is checked.
* `\RequirePackage` behaves identically.
* `\documentclass{myclass}` takes a single name and reports
  `Load the "myclass" class could not be resolved`.
* Commented-out lines are ignored, and the squiggle covers exactly the name.
* Only the preamble is inspected, and the scan stops at `\begin{document}`.

### Completions

| You type | You get |
| --- | --- |
| `\usepac` | `\usepackage`; accepting inserts `\usepackage{…}` with the caret inside the braces |
| `\usepackage{ams` | `amsfonts`, `amsmath`, `amssymb`, `amsthm`, … |
| `\usepackage{ams}` | same list, even with the brace already closed |
| `\usepackage{hyperref, ams` | completes just the current list item |
| `\documentclass{art` | `article`, `amsart`, … (classes only) |

Names come from the kpathsea `ls-R` databases, so they reflect what is really
installed, plus anything found in your workspace and extra paths.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `texlance.analysis.extraPaths` | `[]` | Extra roots searched recursively for `.sty`/`.cls`. Relative paths resolve against the workspace folder. Mirrors `python.analysis.extraPaths`. |
| `texlance.analysis.reportMissingPackages` | `"warning"` | Severity of the diagnostic: `none`, `information`, `warning` or `error`. |
| `texlance.kpsewhichPath` | `null` | Path to `kpsewhich`. Leave empty to auto-detect (`PATH`, `/Library/TeX/texbin`, TeX Live and MiKTeX installs). |
| `texlance.preamble.maxLines` | `500` | Maximum number of lines scanned for preamble commands. |
| `texlance.completion.enabled` | `true` | Offer command, package and class completions. |
| `texlance.trace.server` | `"off"` | Trace client ↔ server communication. |

```jsonc
{
  "texlance.analysis.extraPaths": ["/path/to/my/sty", "./vendor/tex"],
  "texlance.analysis.reportMissingPackages": "error"
}
```

## Commands

* **TeXlance: Refresh Package Index** — re-scan `ls-R` databases, extra paths
  and the workspace.
* **TeXlance: Show Output** — open the language server log.
* **TeXlance: Restart Language Server**.

## How resolution works

For `\usepackage{foo}` TeXlance looks for `foo.sty` in this order:

1. the directory of the document (TeX's `.`),
2. every `texlance.analysis.extraPaths` entry (recursive, depth-capped),
3. the workspace folders (recursive, depth-capped),
4. `kpsewhich foo.sty`, i.e. the real TeX search path.

Only names that survive all four steps are reported. All installed-package
lookups for a document are batched into a **single** `kpsewhich` invocation,
and `kpsewhich` is run with the document directory as its working directory, so
`\usepackage{local}` next to your `.tex` file resolves exactly like it does for
LaTeX itself.

## Requirements

* VS Code 1.91 or newer.
* A TeX distribution providing `kpsewhich` (TeX Live, MacTeX, MiKTeX, …).
  Without it, TeXlance still resolves local files and extra paths and warns
  once that installed packages cannot be checked.

## Development

```sh
npm install          # installs the workspaces (core, server) and the client
npm run build        # bundle dist/extension.js and dist/server.js
npm run watch        # rebuild on change
npm test             # typecheck + unit tests
npm run test:integration   # end-to-end tests in a real VS Code
npm run package      # produce texlance-0.1.0.vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

### Layout

```
core/    @texlance/core  – preamble parsing, kpsewhich wrapper, index, resolution
server/  texlance-server – LSP server (diagnostics, completions)
src/     client          – VS Code extension entry point
test/    unit (Vitest) and integration (@vscode/test-electron) tests + fixtures
```

## License

MIT

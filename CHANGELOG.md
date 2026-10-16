# Changelog

All notable changes to the TeXlance extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-16

### Added

- Language server that resolves `\documentclass`, `\usepackage` and
  `\RequirePackage` against the document folder, `texlance.analysis.extraPaths`,
  the workspace and `kpsewhich`.
- `reportMissingPackages` diagnostic (`Load the "xxx" package could not be
  resolved`) shown as `TeXlance(reportMissingPackages)`.
- Command completions with snippets (`\usepac` → `\usepackage{…}`) and
  package/class name completions sourced from the kpathsea `ls-R` databases and
  the workspace.
- Settings: `texlance.analysis.extraPaths`,
  `texlance.analysis.reportMissingPackages`, `texlance.kpsewhichPath`,
  `texlance.preamble.maxLines`, `texlance.completion.enabled`,
  `texlance.trace.server`.
- Commands: `TeXlance: Refresh Package Index`, `TeXlance: Show Output`,
  `TeXlance: Restart Language Server`.
- Unit tests (Vitest) and end-to-end tests (`@vscode/test-electron`).

[0.1.0]: https://github.com/myhsia/TeXlance/releases/tag/v0.1.0

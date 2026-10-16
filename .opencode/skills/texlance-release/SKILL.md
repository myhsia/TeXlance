---
name: TeXlance Release
description: Version, tag, package and publish TeXlance — VSIX packaging, GitHub releases, the GitHub Actions Marketplace publish job and its VSCE_PAT secret, and diagnosing upload failures such as "Extension package is malformed/corrupted".
---

# TeXlance Release

## When to use

Bumping the version, cutting a release, producing a VSIX, or debugging a
Marketplace upload or publish failure.

## Release workflow

1. Bump `version` in the root `package.json` and update `CHANGELOG.md`; commit.
2. `git tag -a vX.Y.Z -m "TeXlance vX.Y.Z" && git push origin main vX.Y.Z`.
3. CI runs: matrix tests → `Package VSIX` (artifact `texlance-vsix`) →
   `Publish release` on `refs/tags/v*`, attaching the VSIX via
   `softprops/action-gh-release` → `Publish to Marketplace` if `VSCE_PAT` is
   set, which first proves the secret with `vsce verify-pat <publisher>`.
4. Verify with `gh release view vX.Y.Z --json assets`.

To publish without cutting a tag, run the workflow manually:
`gh workflow run ci.yml --ref main`, or locally
`VSCE_PAT=<token> npx vsce publish --packagePath texlance-<version>.vsix`.

## Getting a Personal Access Token (VSCE_PAT)

`vsce` has **no browser login** — the Marketplace account email alone is not
enough, and `vsce login` only prompts for an existing token.

1. Sign in at <https://dev.azure.com> with the same Microsoft account that owns
   the Marketplace publisher. Create a free organization if prompted (its name
   is irrelevant).
2. Open <https://dev.azure.com/_usersSettings/tokens> → **New Token**.
3. Set Organization to **All accessible organizations** — required, the default
   single-org choice fails publishing.
4. Scopes → **Custom defined** → expand **Marketplace** → tick **Manage**.
5. Create and copy the token immediately; Azure DevOps shows it once.
6. Store it. For CI (recommended):

   ```sh
   gh secret set VSCE_PAT        # interactively; the workflow reads secrets.VSCE_PAT
   ```

   For local publishing, `vsce login` persists the token to the **OS keychain**
   (macOS Keychain / Windows Credential Manager / libsecret), under service
   `vscode-vsce` and account = publisher name — **not** `~/.vsce`. Set
   `VSCE_STORE=file` to use `~/.vsce` instead.

   ```sh
   vsce login <publisher>        # paste at the prompt
   # history-safe alternative, avoids the token in shell history and ps:
   read -rs "PAT?PAT: " && VSCE_PAT="$PAT" npx vsce publish --packagePath ./*.vsix; unset PAT
   ```

7. Prove the token works before publishing:

   ```sh
   vsce ls-publishers            # lists publishers reachable with the stored PAT
   vsce verify-pat <publisher>   # "The Personal Access Token verification succeeded …"
   ```

The token expires; when it does, CI publishing fails and the secret must be
replaced. The PAT must belong to the account that owns the publisher, and the
`publisher` value in `package.json` must match the Marketplace exactly.

## Gotchas

- `ERROR Extension package is malformed/corrupted` is a generic wrapper thrown
  whenever the Marketplace cannot extract the package **at all**; it carries no
  real diagnostic (<https://github.com/microsoft/vscode-vsce/issues/211>).
  Check, in order: case-insensitive duplicate paths (most common), SVG assets
  (blocked), icon smaller than 128×128 or non-square — then suspect the upload
  path before repackaging. A valid VSIX is byte-identical everywhere; verify
  with `unzip -t`,
  `python3 -c "import zipfile; zipfile.ZipFile(p).testzip()"` and a PNG
  chunk-CRC walk before blaming the package.
- `vsce publish` with no token fails as
  `TF400813: The user 'aaaaaaaa-…' is not authorized to access this resource`.
- `--skip-duplicate` looks the version up **before** uploading and returns
  early, so it can report success without ever exercising the token. Verify the
  secret separately (`vsce verify-pat <publisher>`), or a mis-scoped PAT will
  only surface on the next real version bump.
- Right after the first publish the gallery API can report the extension as
  public while `marketplace.visualstudio.com/items?itemName=<publisher>.<ext>`
  still returns 404. It propagates within minutes; confirm against the CDN
  assets instead of panicking:
  `https://<publisher>.gallerycdn.vsassets.io/extensions/<publisher>/<ext>/<version>/<timestamp>/Microsoft.VisualStudio.Services.VSIXPackage`.
- Two VSIXes with byte-identical contents can still have different `sha256`
  sums, because zip entries embed DOS timestamps. Compare per-entry hashes
  before concluding an artifact differs.
- `gh release upload --clobber` refreshes an asset but does **not** move the
  tag; re-point the tag if the published source must match the artifact.
- A PAT scoped to one organization, or belonging to a different account than the
  publisher, produces authorization errors that look like package problems.
- A missing `~/.vsce` is **expected** — `vsce login` uses the OS keychain
  (service `vscode-vsce`, account = publisher). Check the keychain with
  `security find-generic-password -s vscode-vsce -a <publisher>` (attributes
  only; never pass `-w`, which prints the secret).
- Publish with `vsce publish --packagePath <file>` after `npm run package`, or
  pass `--no-dependencies`. A bare `vsce publish` re-packages without that flag
  and tries to bundle `node_modules`, even though `dist/` is already bundled.

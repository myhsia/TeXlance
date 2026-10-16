import { readdirSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';

export interface WalkOptions {
  /** Extensions to collect, including the leading dot, e.g. `new Set(['.sty', '.cls'])`. */
  extensions: Set<string>;
  maxDepth?: number;
  ignore?: (name: string) => boolean;
}

const DEFAULT_IGNORED = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.vscode-test',
  '.git',
  '.svn',
  '.hg',
]);

const defaultIgnore = (name: string): boolean => DEFAULT_IGNORED.has(name) || name.startsWith('.');

/**
 * Recursively collects files with the requested extensions under `roots`.
 *
 * The returned map is keyed by file name (e.g. `amsmath.sty`) so callers can
 * look a package up without knowing its directory. Symbolic links are followed
 * (TeX Live installs use them heavily) with cycle protection.
 */
export function walkFileNames(roots: string[], options: WalkOptions): Map<string, string> {
  const maxDepth = options.maxDepth ?? 4;
  const ignore = options.ignore ?? defaultIgnore;
  const found = new Map<string, string>();
  const visited = new Set<string>();

  const walk = (directory: string, depth: number): void => {
    let real: string;
    try {
      real = realpathSync(directory);
    } catch {
      return;
    }
    if (visited.has(real)) {
      return;
    }
    visited.add(real);

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(full);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      if (isDirectory) {
        if (depth < maxDepth && !ignore(entry.name)) {
          walk(full, depth + 1);
        }
        continue;
      }

      if (isFile) {
        const dot = entry.name.lastIndexOf('.');
        if (dot > 0 && options.extensions.has(entry.name.slice(dot).toLowerCase()) && !found.has(entry.name)) {
          found.set(entry.name, full);
        }
      }
    }
  };

  for (const root of roots) {
    if (root.length > 0) {
      walk(root, 0);
    }
  }
  return found;
}

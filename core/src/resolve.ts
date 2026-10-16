import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { walkFileNames } from './fsindex';
import type { Kpse } from './kpse';
import type { NameReference, ResourceKind } from './preamble';

export type ResolveOrigin = 'local' | 'extraPath' | 'workspace' | 'kpse';

export interface Resolution {
  path: string;
  origin: ResolveOrigin;
}

export interface ResolverOptions {
  kpse: Kpse | null;
  /** Directory of the document being analysed; leads the search (like TeX's `.`). */
  documentDirectory: string;
  /** Absolute extra search roots, in priority order. */
  extraPaths: string[];
  /** Absolute workspace folder roots, searched after the extra paths. */
  workspaceFolders: string[];
  maxDepth?: number;
}

export const SEARCH_EXTENSIONS = new Set(['.sty', '.cls']);

/**
 * Resolves package/class names to files on disk.
 *
 * The lookup order mirrors how LaTeX itself searches: the document directory,
 * then user-configured extra paths, then the workspace, and finally the TeX
 * installation through `kpsewhich`.
 */
export class Resolver {
  private extraPathFiles: Map<string, string> | null = null;
  private workspaceFiles: Map<string, string> | null = null;

  constructor(private readonly options: ResolverOptions) {}

  /** Drops directory caches so the next lookup re-scans the filesystem. */
  invalidate(): void {
    this.extraPathFiles = null;
    this.workspaceFiles = null;
  }

  async resolveRefs(refs: NameReference[]): Promise<Map<string, Resolution>> {
    return this.resolveFileNames(refs.map((ref) => fileNameOf(ref.name, ref.kind)));
  }

  async resolveName(name: string, kind: ResourceKind): Promise<Resolution | null> {
    const resolved = await this.resolveFileNames([fileNameOf(name, kind)]);
    return resolved.get(fileNameOf(name, kind)) ?? null;
  }

  async resolveFileNames(fileNames: string[]): Promise<Map<string, Resolution>> {
    const result = new Map<string, Resolution>();
    const pending: string[] = [];

    for (const fileName of new Set(fileNames)) {
      const local = this.options.documentDirectory
        ? path.join(this.options.documentDirectory, fileName)
        : '';
      if (local && existsSync(local)) {
        result.set(fileName, { path: local, origin: 'local' });
      } else {
        pending.push(fileName);
      }
    }

    const extraFiles = this.options.extraPaths.length > 0 ? this.getExtraPathFiles() : new Map<string, string>();
    this.lookupIn(extraFiles, 'extraPath', pending, result);

    const workspaceFiles =
      this.options.workspaceFolders.length > 0 ? this.getWorkspaceFiles() : new Map<string, string>();
    this.lookupIn(workspaceFiles, 'workspace', pending, result);

    if (pending.length > 0 && this.options.kpse) {
      const installed = await this.options.kpse.resolveBatch(pending, this.options.documentDirectory || undefined);
      for (const fileName of pending) {
        const hit = installed.get(fileName);
        if (hit) {
          result.set(fileName, { path: hit, origin: 'kpse' });
        }
      }
    }

    return result;
  }

  private lookupIn(
    files: Map<string, string>,
    origin: ResolveOrigin,
    pending: string[],
    result: Map<string, Resolution>,
  ): void {
    if (files.size === 0 || pending.length === 0) {
      return;
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const hit = files.get(pending[i]);
      if (hit) {
        result.set(pending[i], { path: hit, origin });
        pending.splice(i, 1);
      }
    }
  }

  private getExtraPathFiles(): Map<string, string> {
    this.extraPathFiles ??= walkFileNames(this.options.extraPaths, {
      extensions: SEARCH_EXTENSIONS,
      maxDepth: this.options.maxDepth ?? 4,
    });
    return this.extraPathFiles;
  }

  private getWorkspaceFiles(): Map<string, string> {
    this.workspaceFiles ??= walkFileNames(this.options.workspaceFolders, {
      extensions: SEARCH_EXTENSIONS,
      maxDepth: this.options.maxDepth ?? 4,
    });
    return this.workspaceFiles;
  }
}

export function fileNameOf(name: string, kind: ResourceKind): string {
  return `${name}.${kind === 'class' ? 'cls' : 'sty'}`;
}

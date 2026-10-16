import type { ResourceKind } from './preamble';

export interface IndexData {
  packages: string[];
  classes: string[];
}

function byLowerCase(a: string, b: string): number {
  const lower = a.toLowerCase().localeCompare(b.toLowerCase());
  return lower !== 0 ? lower : a.localeCompare(b);
}

/**
 * The searchable set of package (`.sty`) and class (`.cls`) names known to the
 * editor. Names come from the kpathsea `ls-R` databases, extra paths and the
 * workspace, so completions can be served without spawning processes.
 */
export class IndexDb {
  private readonly packages = new Set<string>();
  private readonly classes = new Set<string>();
  private sortedPackages: string[] | null = null;
  private sortedClasses: string[] | null = null;

  get packageCount(): number {
    return this.packages.size;
  }

  get classCount(): number {
    return this.classes.size;
  }

  /** Adds an entry such as `amsmath.sty`, `beamer.cls` or `./x/amsmath.sty`. */
  addFileEntry(entry: string): void {
    const slash = Math.max(entry.lastIndexOf('/'), entry.lastIndexOf('\\'));
    const trimmed = (slash >= 0 ? entry.slice(slash + 1) : entry).trim();
    const dot = trimmed.lastIndexOf('.');
    if (dot <= 0) {
      return;
    }
    const base = trimmed.slice(0, dot);
    if (base.length === 0) {
      return;
    }
    const extension = trimmed.slice(dot).toLowerCase();
    if (extension === '.sty') {
      this.add(this.packages, base);
    } else if (extension === '.cls') {
      this.add(this.classes, base);
    }
  }

  /**
   * Parses the `ls-R` filename database maintained by `mktexlsr`.
   *
   * Directory headers end with `:` (and start with `./`); every other line is a
   * bare file name belonging to the directory above it.
   */
  addFromLsR(content: string): void {
    for (const line of content.split(/\r?\n/)) {
      if (line.length === 0 || line.charCodeAt(0) === 37 /* % */ || line.startsWith('./')) {
        continue;
      }
      this.addFileEntry(line);
    }
  }

  addEntries(entries: Iterable<string>): void {
    for (const entry of entries) {
      this.addFileEntry(entry);
    }
  }

  search(prefix: string, kind: ResourceKind, limit = 500): string[] {
    const values = this.sorted(kind);
    const needle = prefix.toLowerCase();
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle].toLowerCase() < needle) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const matches: string[] = [];
    for (let i = low; i < values.length && matches.length < limit; i++) {
      if (!values[i].toLowerCase().startsWith(needle)) {
        break;
      }
      matches.push(values[i]);
    }
    return matches;
  }

  contains(name: string, kind: ResourceKind): boolean {
    return (kind === 'class' ? this.classes : this.packages).has(name);
  }

  toData(): IndexData {
    return { packages: this.sorted('package'), classes: this.sorted('class') };
  }

  static fromData(data: IndexData): IndexDb {
    const db = new IndexDb();
    for (const name of data.packages) {
      db.packages.add(name);
    }
    for (const name of data.classes) {
      db.classes.add(name);
    }
    return db;
  }

  private add(target: Set<string>, name: string): void {
    if (target.has(name)) {
      return;
    }
    target.add(name);
    if (target === this.packages) {
      this.sortedPackages = null;
    } else {
      this.sortedClasses = null;
    }
  }

  private sorted(kind: ResourceKind): string[] {
    if (kind === 'class') {
      this.sortedClasses ??= [...this.classes].sort(byLowerCase);
      return this.sortedClasses;
    }
    this.sortedPackages ??= [...this.packages].sort(byLowerCase);
    return this.sortedPackages;
  }
}

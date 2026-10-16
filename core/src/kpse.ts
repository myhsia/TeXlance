import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Set when the process could not be spawned at all (e.g. the binary is missing). */
  failedToStart: boolean;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export type ExecRunner = (file: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

export const defaultRunner: ExecRunner = (file, args, options) =>
  new Promise<ExecResult>((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout ?? 20_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const errno = error as NodeJS.ErrnoException | null;
        resolve({
          code: error ? (errno?.code === 'ENOENT' ? 127 : 1) : 0,
          stdout: stdout ? stdout.toString() : '',
          stderr: stderr ? stderr.toString() : '',
          failedToStart: errno?.code === 'ENOENT',
        });
      },
    );
  });

export interface KpseDiscoveryOptions {
  /** Explicit path from settings. When given it is tried first. */
  executable?: string | null;
  runner?: ExecRunner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

const TEXMF_VARIABLES = [
  'TEXMFDIST',
  'TEXMFLOCAL',
  'TEXMFHOME',
  'TEXMFVAR',
  'TEXMFCONFIG',
  'TEXMFSYSVAR',
  'TEXMFSYSCONFIG',
];

function numericDescending(a: string, b: string): number {
  return b.localeCompare(a, 'en', { numeric: true });
}

function listDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * A thin, injectable wrapper around the `kpsewhich` executable.
 *
 * `kpsewhich` is the authoritative way to ask a TeX installation whether a
 * `.sty`/`.cls` file exists, so all installed-package lookups go through here.
 */
export class Kpse {
  readonly executable: string;

  private readonly runner: ExecRunner;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly variableCache = new Map<string, string | null>();

  constructor(executable: string, options: { runner?: ExecRunner; env?: NodeJS.ProcessEnv } = {}) {
    this.executable = executable;
    this.runner = options.runner ?? defaultRunner;
    this.env = options.env;
  }

  /** Ordered list of plausible `kpsewhich` locations for the current platform. */
  static candidates(options: KpseDiscoveryOptions = {}): string[] {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const exe = platform === 'win32' ? 'kpsewhich.exe' : 'kpsewhich';
    const result: string[] = [];
    const push = (candidate: string | null | undefined): void => {
      if (candidate && candidate.trim().length > 0 && !result.includes(candidate)) {
        result.push(candidate);
      }
    };

    push(options.executable);

    const pathValue = env.PATH ?? (env as Record<string, string | undefined>).Path ?? '';
    const separator = platform === 'win32' ? ';' : ':';
    for (const directory of pathValue.split(separator)) {
      if (directory.length > 0) {
        push(path.join(directory, exe));
      }
    }

    if (platform === 'win32') {
      const localAppData = env.LOCALAPPDATA;
      const programFiles = env.ProgramFiles;
      if (localAppData) {
        push(path.join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', exe));
        push(path.join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', exe));
      }
      if (programFiles) {
        push(path.join(programFiles, 'MiKTeX', 'miktex', 'bin', 'x64', exe));
      }
    } else {
      push(`/Library/TeX/texbin/${exe}`);
      push(`/opt/homebrew/bin/${exe}`);
      push(`/usr/local/bin/${exe}`);
      push(`/opt/local/bin/${exe}`);
      push(`/usr/bin/${exe}`);
    }

    const texLiveRoots =
      platform === 'win32'
        ? ['C:\\texlive', 'C:\\Program Files\\texlive']
        : ['/usr/local/texlive', '/opt/texlive', '/usr/local/TeX'];
    for (const root of texLiveRoots) {
      for (const year of listDirectories(root).sort(numericDescending)) {
        const binDirectory = path.join(root, year, 'bin');
        for (const arch of listDirectories(binDirectory).sort()) {
          push(path.join(binDirectory, arch, exe));
        }
      }
    }

    return result;
  }

  /** Locates a working `kpsewhich`, or returns `null` when Tex is unavailable. */
  static async discover(options: KpseDiscoveryOptions = {}): Promise<Kpse | null> {
    const runner = options.runner ?? defaultRunner;
    const env = options.env ?? process.env;
    for (const candidate of Kpse.candidates(options)) {
      const kpse = new Kpse(candidate, { runner, env });
      if (await kpse.isUsable()) {
        return kpse;
      }
    }
    return null;
  }

  async isUsable(): Promise<boolean> {
    const result = await this.run(['--version']);
    return !result.failedToStart && (result.code === 0 || /kpathsea/i.test(result.stdout));
  }

  run(args: string[], cwd?: string): Promise<ExecResult> {
    return this.runner(this.executable, args, { cwd, env: this.env });
  }

  /** Reads a kpathsea variable such as `TEXMFDIST`. */
  async varValue(name: string): Promise<string | null> {
    const cached = this.variableCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.run(['--var-value', name]);
    const value = result.failedToStart ? null : result.stdout.trim() || null;
    this.variableCache.set(name, value);
    return value;
  }

  /** Directory list of the TeX search path for a format (e.g. `tex`). */
  async showPath(format = 'tex'): Promise<string[]> {
    const result = await this.run([`--show-path=${format}`]);
    if (result.failedToStart) {
      return [];
    }
    return result.stdout
      .split(path.delimiter)
      .map((entry) => entry.replace(/^!!/, '').replace(/[\\/]+$/, ''))
      .filter((entry) => entry.length > 0);
  }

  /** Texmf tree roots derived from the standard kpathsea variables. */
  async texmfRoots(): Promise<string[]> {
    const roots = new Set<string>();
    for (const name of TEXMF_VARIABLES) {
      const value = await this.varValue(name);
      if (!value) {
        continue;
      }
      for (const part of value.split(path.delimiter)) {
        const cleaned = part.replace(/^!!/, '').replace(/[\\/]+$/, '');
        if (cleaned.length > 0 && cleaned !== '{') {
          roots.add(cleaned);
        }
      }
    }
    return [...roots];
  }

  async resolve(fileName: string, cwd?: string): Promise<string | null> {
    const resolved = await this.resolveBatch([fileName], cwd);
    return resolved.get(fileName) ?? null;
  }

  /**
   * Resolves many file names through a *single* `kpsewhich` invocation.
   *
   * `kpsewhich` prints one line per argument and leaves the line empty when the
   * file cannot be found, which makes batching safe and dramatically cheaper
   * than one process per package.
   */
  async resolveBatch(fileNames: string[], cwd?: string): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    if (fileNames.length === 0) {
      return results;
    }

    const unique = [...new Set(fileNames)];
    const result = await this.run(unique, cwd);
    if (result.failedToStart) {
      for (const fileName of unique) {
        results.set(fileName, null);
      }
      return results;
    }

    // kpathsea finds local files first because `.` leads the search path, so the
    // caller passes the document directory as `cwd` to make sibling files resolve.
    const lines = result.stdout.split(/\r?\n/);
    unique.forEach((fileName, index) => {
      const line = (lines[index] ?? '').trim();
      results.set(fileName, line.length > 0 ? line : null);
    });
    return results;
  }
}

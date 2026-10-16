import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Position } from 'vscode-languageserver-types';
import type { ExecResult, ExecRunner } from '@texlance/core';

export function doc(text: string, uri = 'file:///tmp/project/main.tex'): TextDocument {
  return TextDocument.create(uri, 'latex', 1, text);
}

/**
 * Splits a fixture on the first `|` and returns the text without it plus the
 * position the marker was at.
 */
export function withCursor(marked: string): { text: string; position: Position } {
  const index = marked.indexOf('|');
  if (index < 0) {
    throw new Error('fixture is missing the "|" cursor marker');
  }
  const text = marked.slice(0, index) + marked.slice(index + 1);
  const before = marked.slice(0, index);
  const lines = before.split('\n');
  return {
    text,
    position: { line: lines.length - 1, character: lines[lines.length - 1].length },
  };
}

export const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '', failedToStart: false });

export const missing: ExecResult = { code: 127, stdout: '', stderr: '', failedToStart: true };

/** Builds an `ExecRunner` from a function keyed by the command arguments. */
export function fakeRunner(
  handler: (args: string[], cwd: string | undefined) => ExecResult | undefined,
): ExecRunner {
  return async (_file, args, options) => handler(args, options.cwd) ?? missing;
}

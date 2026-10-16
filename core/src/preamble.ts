import { Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export type ResourceKind = 'package' | 'class';

/** A single name requested by a preamble command, e.g. `amsmath` in `\usepackage{amsmath}`. */
export interface NameReference {
  /** The bare name, without extension. */
  name: string;
  kind: ResourceKind;
  /** Extension the name is resolved with: `sty` for packages, `cls` for classes. */
  extension: 'sty' | 'cls';
  /** The command that requested it, e.g. `usepackage`. */
  command: string;
  /** Range of the name token itself, used for diagnostics and completion edits. */
  range: Range;
  /** Range of the enclosing `{ ... }` argument. */
  argumentRange: Range;
}

export interface Preamble {
  refs: NameReference[];
  /** Whether `\begin{document}` was found (i.e. the document actually has a preamble). */
  hasDocumentEnvironment: boolean;
}

/** Commands that take a comma separated list of package names. */
export const PACKAGE_COMMANDS = new Set(['usepackage', 'RequirePackage', 'RequirePackageWithOptions']);

/** Commands that take a single class name. */
export const CLASS_COMMANDS = new Set(['documentclass', 'LoadClass']);

const DOCUMENT_BEGIN = '\\begin{document}';

/** True when the character at `index` is escaped by an odd number of preceding backslashes. */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

/**
 * Blanks out TeX comments while preserving every character offset, so positions
 * computed against the returned string are valid for the original text.
 */
export function stripComments(text: string): string {
  const chars = text.split('');
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      } else {
        chars[i] = ' ';
      }
      continue;
    }
    if (char === '%' && !isEscaped(text, i)) {
      inComment = true;
      chars[i] = ' ';
    }
  }
  return chars.join('');
}

/** Returns the index of the `}` matching the `{` at `openIndex`, or -1. */
export function findMatchingBrace(text: string, openIndex: number, limit: number): number {
  let depth = 0;
  for (let i = openIndex; i < limit; i++) {
    const char = text[i];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Skips over an optional `[ ... ]` argument starting at `openIndex`; returns the index after it. */
function skipOptionalArgument(text: string, openIndex: number, limit: number): number {
  let depth = 0;
  for (let i = openIndex; i < limit; i++) {
    const char = text[i];
    if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return limit;
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function isCommandChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z@]/.test(char);
}

interface Segment {
  text: string;
  start: number;
  end: number;
}

/** Splits the inside of a `{ ... }` argument on commas and trims each segment. */
function splitSegments(inner: string, baseOffset: number): Segment[] {
  const segments: Segment[] = [];
  let segmentStart = 0;
  for (let i = 0; i <= inner.length; i++) {
    if (i === inner.length || inner[i] === ',') {
      let start = segmentStart;
      let end = i;
      while (start < end && isWhitespace(inner[start])) {
        start++;
      }
      while (end > start && isWhitespace(inner[end - 1])) {
        end--;
      }
      segments.push({ text: inner.slice(start, end), start: baseOffset + start, end: baseOffset + end });
      segmentStart = i + 1;
    }
  }
  return segments;
}

/**
 * Parses the commands of interest out of a document preamble.
 *
 * The scan stops at `\begin{document}` (when present) or after `maxLines` lines,
 * so only the preamble is ever inspected.
 */
export function parsePreamble(document: TextDocument, maxLines: number): Preamble {
  const text = document.getText();
  const stripped = stripComments(text);

  let end = stripped.indexOf(DOCUMENT_BEGIN);
  const hasDocumentEnvironment = end >= 0;
  if (end < 0) {
    end = stripped.length;
  }
  const requestedEnd = document.offsetAt({ line: Math.max(0, maxLines), character: 0 });
  if (requestedEnd > 0 && requestedEnd < end) {
    end = requestedEnd;
  }

  const refs: NameReference[] = [];

  const pushSegment = (
    segment: Segment,
    kind: ResourceKind,
    command: string,
    argumentRange: Range,
  ): void => {
    // Names must be plain words; anything with TeX syntax in it is not a file name.
    if (segment.text.length === 0 || /[\\{}#$^&~%]/.test(segment.text)) {
      return;
    }
    refs.push({
      name: segment.text,
      kind,
      extension: kind === 'class' ? 'cls' : 'sty',
      command,
      range: Range.create(document.positionAt(segment.start), document.positionAt(segment.end)),
      argumentRange,
    });
  };

  let index = 0;
  while (index < end) {
    const backslash = stripped.indexOf('\\', index);
    if (backslash < 0 || backslash >= end) {
      break;
    }

    let cursor = backslash + 1;
    while (cursor < end && isCommandChar(stripped[cursor])) {
      cursor++;
    }
    const command = stripped.slice(backslash + 1, cursor);
    index = cursor;

    if (command.length === 0) {
      continue;
    }
    const isPackageCommand = PACKAGE_COMMANDS.has(command);
    const isClassCommand = CLASS_COMMANDS.has(command);
    if (!isPackageCommand && !isClassCommand) {
      continue;
    }

    while (cursor < end && isWhitespace(stripped[cursor])) {
      cursor++;
    }
    if (stripped[cursor] === '[') {
      cursor = skipOptionalArgument(stripped, cursor, end);
    }
    while (cursor < end && isWhitespace(stripped[cursor])) {
      cursor++;
    }
    if (stripped[cursor] !== '{') {
      continue;
    }

    const close = findMatchingBrace(stripped, cursor, end);
    if (close < 0) {
      break;
    }

    const argumentRange = Range.create(
      document.positionAt(cursor + 1),
      document.positionAt(close),
    );
    const inner = stripped.slice(cursor + 1, close);

    if (isClassCommand) {
      const [segment] = splitSegments(inner, cursor + 1);
      if (segment) {
        pushSegment(segment, 'class', command, argumentRange);
      }
    } else {
      for (const segment of splitSegments(inner, cursor + 1)) {
        pushSegment(segment, 'package', command, argumentRange);
      }
    }

    index = close + 1;
  }

  return { refs, hasDocumentEnvironment };
}

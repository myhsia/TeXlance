import type { CompletionItem } from 'vscode-languageserver-types';
import { CompletionItemKind, InsertTextFormat, Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { IndexDb } from './index-db';
import type { ResourceKind } from './preamble';
import { CLASS_COMMANDS, PACKAGE_COMMANDS, findMatchingBrace, stripComments } from './preamble';

/** How far back a completion request looks for an enclosing argument. */
const SCAN_LIMIT = 4000;

export interface CommandDefinition {
  name: string;
  insertText: string;
  detail: string;
}

/**
 * Preamble commands offered as snippets. Accepting one inserts the braces and
 * places the caret inside them, e.g. `\usepackage{${1}}`.
 */
export const PREAMBLE_COMMANDS: CommandDefinition[] = [
  { name: 'documentclass', insertText: '\\documentclass{${1}}', detail: 'Declare the document class' },
  { name: 'usepackage', insertText: '\\usepackage{${1}}', detail: 'Load a package' },
  { name: 'RequirePackage', insertText: '\\RequirePackage{${1}}', detail: 'Load a package (required)' },
  {
    name: 'RequirePackageWithOptions',
    insertText: '\\RequirePackageWithOptions{${1}}',
    detail: 'Load a package passing on class options',
  },
  { name: 'PassOptionsToPackage', insertText: '\\PassOptionsToPackage{${1}}{${2}}', detail: 'Pass options to a package' },
  { name: 'PassOptionsToClass', insertText: '\\PassOptionsToClass{${1}}{${2}}', detail: 'Pass options to a class' },
  { name: 'newcommand', insertText: '\\newcommand{\\${1}}[${2}]{${3}}', detail: 'Define a new command' },
  { name: 'renewcommand', insertText: '\\renewcommand{\\${1}}[${2}]{${3}}', detail: 'Redefine a command' },
  { name: 'providecommand', insertText: '\\providecommand{\\${1}}[${2}]{${3}}', detail: 'Define a command if undefined' },
  {
    name: 'newenvironment',
    insertText: '\\newenvironment{${1}}{${2}}{${3}}',
    detail: 'Define a new environment',
  },
  { name: 'newtheorem', insertText: '\\newtheorem{${1}}{${2}}', detail: 'Define a new theorem environment' },
  { name: 'setlength', insertText: '\\setlength{\\${1}}{${2}}', detail: 'Set a length' },
  { name: 'addtolength', insertText: '\\addtolength{\\${1}}{${2}}', detail: 'Adjust a length' },
  { name: 'setcounter', insertText: '\\setcounter{${1}}{${2}}', detail: 'Set a counter' },
  { name: 'title', insertText: '\\title{${1}}', detail: 'Set the document title' },
  { name: 'author', insertText: '\\author{${1}}', detail: 'Set the document author' },
  { name: 'date', insertText: '\\date{${1}}', detail: 'Set the document date' },
  { name: 'maketitle', insertText: '\\maketitle', detail: 'Typeset the title' },
  { name: 'ProvidesPackage', insertText: '\\ProvidesPackage{${1}}', detail: 'Declare a package (in a .sty file)' },
  { name: 'ProvidesClass', insertText: '\\ProvidesClass{${1}}', detail: 'Declare a class (in a .cls file)' },
  { name: 'LoadClass', insertText: '\\LoadClass{${1}}', detail: 'Load a class from within a class file' },
  { name: 'DeclareOption', insertText: '\\DeclareOption{${1}}{${2}}', detail: 'Declare a package option' },
  { name: 'ProcessOptions', insertText: '\\ProcessOptions', detail: 'Process declared options' },
  { name: 'NeedsTeXFormat', insertText: '\\NeedsTeXFormat{${1}}', detail: 'Require a LaTeX format version' },
];

export interface CommandCompletionContext {
  kind: 'command';
  prefix: string;
  range: ReturnType<typeof Range.create>;
}

export interface ResourceCompletionContext {
  kind: 'resource';
  resourceKind: ResourceKind;
  command: string;
  prefix: string;
  range: ReturnType<typeof Range.create>;
  argumentRange: ReturnType<typeof Range.create>;
}

export interface NoneCompletionContext {
  kind: 'none';
}

export type CompletionContext = CommandCompletionContext | ResourceCompletionContext | NoneCompletionContext;

/** Per-item payload used by `completionItem/resolve` to look up the real path. */
export interface ResolutionCompletionData {
  uri: string;
  name: string;
  resourceKind: ResourceKind;
}

function isCommandChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z@]/.test(char);
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Finds the innermost `{ ... }` group containing `offset`.
 *
 * Returns `undefined` when the caret sits outside every brace group, which is
 * the signal that no package/class argument is being edited.
 */
function findEnclosingArgument(
  text: string,
  offset: number,
): { openBrace: number; closeBrace: number } | undefined {
  let depth = 0;
  const limit = Math.max(0, offset - SCAN_LIMIT);
  for (let i = offset - 1; i >= limit; i--) {
    const char = text[i];
    if (char === '}') {
      if (depth === 0) {
        return undefined;
      }
      depth--;
    } else if (char === '{') {
      if (depth === 0) {
        const close = findMatchingBrace(text, i, text.length);
        return { openBrace: i, closeBrace: close < 0 ? text.length : close };
      }
      depth--;
    }
  }
  return undefined;
}

/** Reads the command name (and skips optional `[ ... ]` arguments) preceding a `{`. */
function findCommandBefore(text: string, openBrace: number): string | undefined {
  let cursor = openBrace - 1;
  while (cursor >= 0 && isWhitespace(text[cursor])) {
    cursor--;
  }
  if (cursor >= 0 && text[cursor] === ']') {
    let depth = 0;
    for (; cursor >= 0; cursor--) {
      if (text[cursor] === ']') {
        depth++;
      } else if (text[cursor] === '[') {
        depth--;
        if (depth === 0) {
          cursor--;
          break;
        }
      }
    }
    while (cursor >= 0 && isWhitespace(text[cursor])) {
      cursor--;
    }
  }
  const end = cursor + 1;
  while (cursor >= 0 && isCommandChar(text[cursor])) {
    cursor--;
  }
  const name = text.slice(cursor + 1, end);
  if (name.length === 0 || cursor < 0 || text[cursor] !== '\\') {
    return undefined;
  }
  return name;
}

/** The comma-delimited chunk of an argument the caret currently sits in. */
function segmentAt(text: string, offset: number, lowerBound: number, upperBound: number): { start: number; end: number } {
  let start = offset;
  while (start > lowerBound && text[start - 1] !== ',') {
    start--;
  }
  let end = offset;
  while (end < upperBound && text[end] !== ',') {
    end++;
  }
  while (start < end && isWhitespace(text[start])) {
    start++;
  }
  while (end > start && isWhitespace(text[end - 1])) {
    end--;
  }
  return { start, end };
}

/** Classifies the caret position to decide which completions to offer. */
export function getCompletionContext(document: TextDocument, position: { line: number; character: number }): CompletionContext {
  const text = document.getText();
  const stripped = stripComments(text);
  const offset = document.offsetAt(position);

  const argument = findEnclosingArgument(stripped, offset);
  if (argument) {
    const command = findCommandBefore(stripped, argument.openBrace);
    if (command && (PACKAGE_COMMANDS.has(command) || CLASS_COMMANDS.has(command))) {
      const resourceKind: ResourceKind = CLASS_COMMANDS.has(command) ? 'class' : 'package';
      const segment = segmentAt(stripped, offset, argument.openBrace + 1, argument.closeBrace);
      return {
        kind: 'resource',
        resourceKind,
        command,
        prefix: stripped.slice(segment.start, offset),
        range: Range.create(document.positionAt(segment.start), document.positionAt(segment.end)),
        argumentRange: Range.create(
          document.positionAt(argument.openBrace + 1),
          document.positionAt(argument.closeBrace),
        ),
      };
    }
    return { kind: 'none' };
  }

  let wordStart = offset;
  while (wordStart > 0 && isCommandChar(stripped[wordStart - 1])) {
    wordStart--;
  }
  const word = stripped.slice(wordStart, offset);
  const backslash = wordStart - 1;
  if (backslash >= 0 && stripped[backslash] === '\\' && stripped[backslash - 1] !== '\\') {
    if (PREAMBLE_COMMANDS.some((command) => command.name === word)) {
      return { kind: 'none' };
    }
    return {
      kind: 'command',
      prefix: `\\${word}`,
      range: Range.create(document.positionAt(backslash), document.positionAt(offset)),
    };
  }

  return { kind: 'none' };
}

/** Builds completion items for a classified caret position. */
export function buildCompletionItems(
  context: CompletionContext,
  index: IndexDb,
  documentUri: string,
): CompletionItem[] {
  if (context.kind === 'command') {
    const needle = context.prefix.toLowerCase();
    return PREAMBLE_COMMANDS.filter((command) => `\\${command.name}`.toLowerCase().startsWith(needle)).map(
      (command): CompletionItem => ({
        label: `\\${command.name}`,
        kind: CompletionItemKind.Function,
        detail: command.detail,
        filterText: `\\${command.name}`,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { range: context.range, newText: command.insertText },
      }),
    );
  }

  if (context.kind === 'resource') {
    return index.search(context.prefix, context.resourceKind).map(
      (name): CompletionItem => ({
        label: name,
        kind: context.resourceKind === 'class' ? CompletionItemKind.Class : CompletionItemKind.Module,
        detail: context.resourceKind === 'class' ? 'document class' : 'package',
        filterText: name,
        textEdit: { range: context.range, newText: name },
        data: { uri: documentUri, name, resourceKind: context.resourceKind } satisfies ResolutionCompletionData,
      }),
    );
  }

  return [];
}

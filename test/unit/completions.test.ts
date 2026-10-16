import { describe, expect, it } from 'vitest';
import { InsertTextFormat } from 'vscode-languageserver-types';
import { IndexDb, buildCompletionItems, getCompletionContext } from '@texlance/core';
import { doc, withCursor } from './helpers';

function makeIndex(): IndexDb {
  const index = new IndexDb();
  index.addEntries([
    'amsmath.sty',
    'amssymb.sty',
    'amsthm.sty',
    'amsfonts.sty',
    'article.cls',
    'amsart.cls',
    'beamer.cls',
  ]);
  return index;
}

function contextAt(marked: string) {
  const { text, position } = withCursor(marked);
  const document = doc(text);
  return { document, position, context: getCompletionContext(document, position) };
}

describe('getCompletionContext', () => {
  it('detects a partially typed command', () => {
    const { context } = contextAt('\\usepac|');
    expect(context.kind).toBe('command');
    if (context.kind === 'command') {
      expect(context.prefix).toBe('\\usepac');
    }
  });

  it('detects a package argument', () => {
    const { context } = contextAt('\\usepackage{ams|');
    expect(context.kind).toBe('resource');
    if (context.kind === 'resource') {
      expect(context.resourceKind).toBe('package');
      expect(context.prefix).toBe('ams');
    }
  });

  it('detects a package argument with the brace already closed', () => {
    const { document, context } = contextAt('\\usepackage{ams|}');
    expect(context.kind).toBe('resource');
    if (context.kind === 'resource') {
      expect(context.prefix).toBe('ams');
      expect(document.offsetAt(context.range.start)).toBe(12);
      expect(document.offsetAt(context.range.end)).toBe(15);
    }
  });

  it('targets only the current item of a package list', () => {
    const { document, context } = contextAt('\\usepackage{hyperref, ams|math, xcolor}');
    expect(context.kind).toBe('resource');
    if (context.kind === 'resource') {
      expect(context.prefix).toBe('ams');
      const start = document.offsetAt(context.range.start);
      const end = document.offsetAt(context.range.end);
      expect(document.getText().slice(start, end)).toBe('amsmath');
    }
  });

  it('offers every package when the braces are empty', () => {
    const { context } = contextAt('\\usepackage{|}');
    expect(context.kind).toBe('resource');
    if (context.kind === 'resource') {
      expect(context.prefix).toBe('');
    }
  });

  it('detects a class argument', () => {
    const { context } = contextAt('\\documentclass[11pt]{art|');
    expect(context.kind).toBe('resource');
    if (context.kind === 'resource') {
      expect(context.resourceKind).toBe('class');
      expect(context.prefix).toBe('art');
    }
  });

  it('handles \\RequirePackage', () => {
    const { context } = contextAt('\\RequirePackage{ams|');
    expect(context.kind).toBe('resource');
    if (context.kind === 'resource') {
      expect(context.resourceKind).toBe('package');
    }
  });

  it('ignores the document body', () => {
    const { context } = contextAt('\\begin{document}\nhello wor|ld\n\\end{document}');
    expect(context.kind).toBe('none');
  });

  it('stays quiet once a command is complete', () => {
    const { context } = contextAt('\\usepackage|');
    expect(context.kind).toBe('none');
  });
});

describe('buildCompletionItems', () => {
  it('offers package names filtered by prefix', () => {
    const { context } = contextAt('\\usepackage{ams|');
    const labels = buildCompletionItems(context, makeIndex(), 'file:///tmp/main.tex').map((item) => item.label);
    expect(labels).toEqual(['amsfonts', 'amsmath', 'amssymb', 'amsthm']);
  });

  it('offers only classes inside \\documentclass', () => {
    const { context } = contextAt('\\documentclass{a|');
    const labels = buildCompletionItems(context, makeIndex(), 'file:///tmp/main.tex').map((item) => item.label);
    expect(labels).toEqual(['amsart', 'article']);
  });

  it('inserts a snippet that leaves the caret inside the braces', () => {
    const { context } = contextAt('\\usepac|');
    const items = buildCompletionItems(context, makeIndex(), 'file:///tmp/main.tex');
    const item = items.find((entry) => entry.label === '\\usepackage');
    expect(item?.insertTextFormat).toBe(InsertTextFormat.Snippet);
    expect(item?.textEdit).toMatchObject({ newText: '\\usepackage{${1}}' });
  });

  it('carries resolution data on package items', () => {
    const { context } = contextAt('\\usepackage{amsm|');
    const items = buildCompletionItems(context, makeIndex(), 'file:///tmp/main.tex');
    expect(items[0]?.data).toMatchObject({
      uri: 'file:///tmp/main.tex',
      name: 'amsmath',
      resourceKind: 'package',
    });
  });
});

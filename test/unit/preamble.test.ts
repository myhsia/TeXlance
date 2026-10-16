import { describe, expect, it } from 'vitest';
import { parsePreamble, stripComments } from '@texlance/core';
import { doc } from './helpers';

describe('stripComments', () => {
  it('preserves offsets while blanking comments', () => {
    const text = 'a % comment\nb';
    const stripped = stripComments(text);
    expect(stripped).toHaveLength(text.length);
    expect(stripped.indexOf('\n')).toBe(text.indexOf('\n'));
    expect(stripped).toBe('a          \nb');
  });

  it('does not treat \\% as a comment', () => {
    expect(stripComments('100\\% done')).toBe('100\\% done');
  });
});

describe('parsePreamble', () => {
  it('collects a class and a comma separated package list', () => {
    const { refs } = parsePreamble(doc('\\documentclass{article}\n\\usepackage{amsmath, amssymb,amsthm}\n'), 500);
    expect(refs.map((ref) => `${ref.kind}:${ref.name}`)).toEqual([
      'class:article',
      'package:amsmath',
      'package:amssymb',
      'package:amsthm',
    ]);
    expect(refs.map((ref) => ref.extension)).toEqual(['cls', 'sty', 'sty', 'sty']);
  });

  it('points each range at the exact name token', () => {
    const text = '\\documentclass[11pt]{article}\n\\usepackage[utf8]{inputenc, fontenc}\n';
    const document = doc(text);
    const { refs } = parsePreamble(document, 500);
    for (const ref of refs) {
      const start = document.offsetAt(ref.range.start);
      const end = document.offsetAt(ref.range.end);
      expect(text.slice(start, end)).toBe(ref.name);
    }
  });

  it('ignores commands inside comments', () => {
    const { refs } = parsePreamble(doc('% \\usepackage{ghost}\n\\usepackage{real}\n'), 500);
    expect(refs.map((ref) => ref.name)).toEqual(['real']);
  });

  it('handles multi-line and multiple statements', () => {
    const source = [
      '\\documentclass{book}',
      '\\usepackage{',
      '  geometry,',
      '  hyperref',
      '}',
      '\\RequirePackage{amsmath}',
      '',
    ].join('\n');
    const { refs } = parsePreamble(doc(source), 500);
    expect(refs.map((ref) => `${ref.command}:${ref.name}`)).toEqual([
      'documentclass:book',
      'usepackage:geometry',
      'usepackage:hyperref',
      'RequirePackage:amsmath',
    ]);
  });

  it('stops at \\begin{document}', () => {
    const source = '\\documentclass{article}\n\\begin{document}\n\\usepackage{bodypkg}\n\\end{document}\n';
    const { refs, hasDocumentEnvironment } = parsePreamble(doc(source), 500);
    expect(hasDocumentEnvironment).toBe(true);
    expect(refs.map((ref) => ref.name)).toEqual(['article']);
  });

  it('respects the line limit', () => {
    const source = '\\documentclass{article}\n\n\n\\usepackage{later}\n';
    const { refs } = parsePreamble(doc(source), 2);
    expect(refs.map((ref) => ref.name)).toEqual(['article']);
  });

  it('keeps only the first segment for a class', () => {
    const { refs } = parsePreamble(doc('\\documentclass{article}\n'), 500);
    expect(refs).toHaveLength(1);
    expect(refs[0].argumentRange.start).toEqual({ line: 0, character: 15 });
  });

  it('skips names containing TeX syntax', () => {
    const { refs } = parsePreamble(doc('\\usepackage{\\foo, bar}\n'), 500);
    expect(refs.map((ref) => ref.name)).toEqual(['bar']);
  });
});

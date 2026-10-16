import { describe, expect, it } from 'vitest';
import { IndexDb } from '@texlance/core';

const LS_R = [
  '% ls-R -- filename database for kpathsea; do not change this line.',
  './:',
  'asymptote',
  'chktex',
  'tex',
  './tex/latex/amsmath:',
  'amsmath.sty',
  'amsmath-2018-12-01.sty',
  './tex/latex/base:',
  'article.cls',
  'report.cls',
  './tex/latex/amsfonts:',
  'amssymb.sty',
  'amssymb.sty',
  '',
].join('\n');

describe('IndexDb', () => {
  it('parses ls-R databases into package and class names', () => {
    const db = new IndexDb();
    db.addFromLsR(LS_R);
    expect(db.search('', 'package')).toEqual(['amsmath', 'amsmath-2018-12-01', 'amssymb']);
    expect(db.search('', 'class')).toEqual(['article', 'report']);
  });

  it('filters by prefix', () => {
    const db = new IndexDb();
    db.addFromLsR(LS_R);
    expect(db.search('ams', 'package')).toEqual(['amsmath', 'amsmath-2018-12-01', 'amssymb']);
    expect(db.search('amsm', 'package')).toEqual(['amsmath', 'amsmath-2018-12-01']);
    expect(db.search('rep', 'class')).toEqual(['report']);
    expect(db.search('nope', 'package')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const db = new IndexDb();
    db.addFromLsR('Beamer.cls\namsmath.sty\n');
    expect(db.search('bea', 'class')).toEqual(['Beamer']);
    expect(db.search('AMS', 'package')).toEqual(['amsmath']);
  });

  it('deduplicates repeated entries', () => {
    const db = new IndexDb();
    db.addEntries(['amssymb.sty', 'amssymb.sty', './x/amssymb.sty']);
    expect(db.packageCount).toBe(1);
  });

  it('round-trips through data', () => {
    const db = new IndexDb();
    db.addFromLsR(LS_R);
    const restored = IndexDb.fromData(db.toData());
    expect(restored.search('', 'package')).toEqual(db.search('', 'package'));
    expect(restored.search('', 'class')).toEqual(db.search('', 'class'));
  });

  it('never exceeds the requested limit', () => {
    const db = new IndexDb();
    db.addEntries(Array.from({ length: 20 }, (_value, index) => `pkg${index}.sty`));
    expect(db.search('pkg', 'package', 5)).toHaveLength(5);
  });
});

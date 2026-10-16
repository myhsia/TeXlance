import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IndexDb, SEARCH_EXTENSIONS, walkFileNames } from '@texlance/core';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'texlance-fsindex-'));
  mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  mkdirSync(path.join(root, '.hidden'), { recursive: true });
  writeFileSync(path.join(root, 'a', 'b', 'c', 'deep.sty'), '');
  writeFileSync(path.join(root, 'a', 'top.cls'), '');
  writeFileSync(path.join(root, 'a', 'notes.txt'), '');
  writeFileSync(path.join(root, 'node_modules', 'ignored', 'dep.sty'), '');
  writeFileSync(path.join(root, '.hidden', 'hidden.sty'), '');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('walkFileNames', () => {
  it('finds matching extensions recursively, keyed by file name', () => {
    const files = walkFileNames([root], { extensions: SEARCH_EXTENSIONS, maxDepth: 4 });
    expect([...files.keys()].sort()).toEqual(['deep.sty', 'top.cls']);
    expect(files.get('deep.sty')).toBe(path.join(root, 'a', 'b', 'c', 'deep.sty'));
  });

  it('honours the depth limit', () => {
    const files = walkFileNames([root], { extensions: SEARCH_EXTENSIONS, maxDepth: 1 });
    expect([...files.keys()]).toEqual(['top.cls']);
  });

  it('skips node_modules and dot directories', () => {
    const files = walkFileNames([root], { extensions: SEARCH_EXTENSIONS, maxDepth: 6 });
    expect(files.has('dep.sty')).toBe(false);
    expect(files.has('hidden.sty')).toBe(false);
  });

  it('survives missing roots', () => {
    expect(walkFileNames([path.join(root, 'does-not-exist')], { extensions: SEARCH_EXTENSIONS }).size).toBe(0);
  });
});

describe('fixtures', () => {
  it('exposes localpkg.sty through the extra path fixture', () => {
    const extra = path.resolve(process.cwd(), 'test/fixtures/extra');
    const index = new IndexDb();
    index.addEntries(walkFileNames([extra], { extensions: SEARCH_EXTENSIONS, maxDepth: 4 }).keys());
    expect(index.search('localp', 'package')).toEqual(['localpkg']);
  });
});

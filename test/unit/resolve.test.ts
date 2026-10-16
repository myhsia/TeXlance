import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kpse, Resolver } from '@texlance/core';
import type { NameReference, ResourceKind } from '@texlance/core';
import { fakeRunner, ok } from './helpers';

let root: string;

function reference(name: string, kind: ResourceKind): NameReference {
  return {
    name,
    kind,
    extension: kind === 'class' ? 'cls' : 'sty',
    command: kind === 'class' ? 'documentclass' : 'usepackage',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    argumentRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'texlance-resolve-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(path.join(root, 'extra', 'nested', 'deeper'), { recursive: true });
  mkdirSync(path.join(root, 'workspace', 'sub'), { recursive: true });

  writeFileSync(path.join(root, 'docs', 'main.tex'), '\\documentclass{localclass}\n');
  writeFileSync(path.join(root, 'docs', 'localclass.cls'), '');
  writeFileSync(path.join(root, 'extra', 'nested', 'deeper', 'extrapkg.sty'), '');
  writeFileSync(path.join(root, 'extra', 'dup.sty'), 'extra copy');
  writeFileSync(path.join(root, 'workspace', 'dup.sty'), 'workspace copy');
  writeFileSync(path.join(root, 'workspace', 'sub', 'wspkg.sty'), '');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function createResolver(): Resolver {
  const kpse = new Kpse('/fake/kpsewhich', {
    runner: fakeRunner((args) =>
      ok(args.map((arg) => (arg === 'installed.sty' ? '/texlive/installed.sty' : '')).join('\n')),
    ),
  });
  return new Resolver({
    kpse,
    documentDirectory: path.join(root, 'docs'),
    extraPaths: [path.join(root, 'extra')],
    workspaceFolders: [path.join(root, 'workspace')],
    maxDepth: 4,
  });
}

describe('Resolver', () => {
  it('resolves a class sitting next to the document', async () => {
    const resolved = await createResolver().resolveRefs([reference('localclass', 'class')]);
    expect(resolved.get('localclass.cls')).toEqual({
      path: path.join(root, 'docs', 'localclass.cls'),
      origin: 'local',
    });
  });

  it('finds packages nested inside an extra path', async () => {
    const resolved = await createResolver().resolveRefs([reference('extrapkg', 'package')]);
    expect(resolved.get('extrapkg.sty')?.origin).toBe('extraPath');
    expect(resolved.get('extrapkg.sty')?.path).toBe(path.join(root, 'extra', 'nested', 'deeper', 'extrapkg.sty'));
  });

  it('falls back to the workspace', async () => {
    const resolved = await createResolver().resolveRefs([reference('wspkg', 'package')]);
    expect(resolved.get('wspkg.sty')?.origin).toBe('workspace');
  });

  it('prefers extra paths over the workspace', async () => {
    const resolved = await createResolver().resolveRefs([reference('dup', 'package')]);
    expect(resolved.get('dup.sty')?.path).toBe(path.join(root, 'extra', 'dup.sty'));
  });

  it('asks kpsewhich for installed packages', async () => {
    const resolved = await createResolver().resolveRefs([reference('installed', 'package')]);
    expect(resolved.get('installed.sty')).toEqual({ path: '/texlive/installed.sty', origin: 'kpse' });
  });

  it('omits names that cannot be resolved anywhere', async () => {
    const resolved = await createResolver().resolveRefs([
      reference('installed', 'package'),
      reference('ghost', 'package'),
    ]);
    expect(resolved.has('installed.sty')).toBe(true);
    expect(resolved.has('ghost.sty')).toBe(false);
  });

  it('resolves a single name for completion hover', async () => {
    const resolver = createResolver();
    expect(await resolver.resolveName('wspkg', 'package')).toEqual({
      path: path.join(root, 'workspace', 'sub', 'wspkg.sty'),
      origin: 'workspace',
    });
    expect(await resolver.resolveName('ghost', 'package')).toBeNull();
  });
});

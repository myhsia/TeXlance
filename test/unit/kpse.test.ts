import { describe, expect, it } from 'vitest';
import { Kpse } from '@texlance/core';
import type { ExecRunner } from '@texlance/core';
import { fakeRunner, missing, ok } from './helpers';

describe('Kpse.candidates', () => {
  it('puts the configured executable first', () => {
    const candidates = Kpse.candidates({
      executable: '/custom/kpsewhich',
      env: { PATH: '/usr/bin:/bin' },
      platform: 'linux',
    });
    expect(candidates[0]).toBe('/custom/kpsewhich');
    expect(candidates).toContain('/usr/bin/kpsewhich');
  });

  it('knows about MacTeX', () => {
    const candidates = Kpse.candidates({ env: { PATH: '' }, platform: 'darwin' });
    expect(candidates).toContain('/Library/TeX/texbin/kpsewhich');
  });
});

describe('Kpse.discover', () => {
  it('returns the first usable executable', async () => {
    const runner: ExecRunner = async (file, args) =>
      file === '/opt/texbin/kpsewhich' && args[0] === '--version' ? ok('kpathsea version 6.4.2\n') : missing;

    const kpse = await Kpse.discover({
      executable: null,
      runner,
      env: { PATH: '/opt/texbin' },
      platform: 'linux',
    });
    expect(kpse?.executable).toBe('/opt/texbin/kpsewhich');
  });

  it('returns null when nothing works', async () => {
    const kpse = await Kpse.discover({
      runner: fakeRunner(() => missing),
      env: { PATH: '/nowhere' },
      platform: 'linux',
    });
    expect(kpse).toBeNull();
  });
});

describe('Kpse.resolveBatch', () => {
  it('maps one output line per argument and treats blanks as misses', async () => {
    const kpse = new Kpse('/fake/kpsewhich', {
      runner: fakeRunner(() => ok('/texlive/amsmath.sty\n\n/texlive/article.cls\n')),
    });
    const resolved = await kpse.resolveBatch(['amsmath.sty', 'nope.sty', 'article.cls'], '/docs');
    expect(resolved.get('amsmath.sty')).toBe('/texlive/amsmath.sty');
    expect(resolved.get('nope.sty')).toBeNull();
    expect(resolved.get('article.cls')).toBe('/texlive/article.cls');
  });

  it('passes the document directory as the working directory', async () => {
    let seenCwd: string | undefined;
    const kpse = new Kpse('/fake/kpsewhich', {
      runner: fakeRunner((_args, cwd) => {
        seenCwd = cwd;
        return ok('./local.sty\n');
      }),
    });
    await kpse.resolveBatch(['local.sty'], '/docs');
    expect(seenCwd).toBe('/docs');
  });

  it('returns no entries for an empty request', async () => {
    const kpse = new Kpse('/fake/kpsewhich', { runner: fakeRunner(() => ok('')) });
    expect((await kpse.resolveBatch([])).size).toBe(0);
  });
});

describe('Kpse.varValue and texmfRoots', () => {
  it('caches variable lookups', async () => {
    let calls = 0;
    const kpse = new Kpse('/fake/kpsewhich', {
      runner: fakeRunner((args) => {
        calls++;
        return ok(args[1] === 'TEXMFDIST' ? '/texlive/2026/texmf-dist\n' : '');
      }),
    });
    await kpse.varValue('TEXMFDIST');
    await kpse.varValue('TEXMFDIST');
    expect(calls).toBe(1);
  });

  it('strips kpathsea prefixes from tree roots', async () => {
    const values: Record<string, string> = {
      TEXMFDIST: '/texlive/2026/texmf-dist',
      TEXMFLOCAL: '!!/usr/local/texlive/texmf-local',
      TEXMFHOME: '~/texmf/',
    };
    const kpse = new Kpse('/fake/kpsewhich', {
      runner: fakeRunner((args) => ok(`${values[args[1]] ?? ''}\n`)),
    });
    const roots = await kpse.texmfRoots();
    expect(roots).toContain('/texlive/2026/texmf-dist');
    expect(roots).toContain('/usr/local/texlive/texmf-local');
  });
});

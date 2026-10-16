import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const coreEntry = fileURLToPath(new URL('./core/src/index.ts', import.meta.url));

const watch = process.argv.includes('--watch');
const testsOnly = process.argv.includes('--tests');

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  minify: process.env.NODE_ENV === 'production',
};

/** @type {import('esbuild').BuildOptions} */
const runtime = {
  ...base,
  external: ['vscode'],
  alias: { '@texlance/core': coreEntry },
};

/** @type {import('esbuild').BuildOptions} */
const integrationTests = {
  ...base,
  external: ['vscode', 'mocha', '@vscode/test-electron'],
  alias: { '@texlance/core': coreEntry },
  entryPoints: [
    'test/integration/runTest.ts',
    'test/integration/suite/index.ts',
    'test/integration/suite/extension.test.ts',
  ],
  outdir: 'test/integration/out',
  outbase: 'test/integration',
};

/** @type {import('esbuild').BuildOptions[]} */
const targets = testsOnly
  ? [integrationTests]
  : [
      { ...runtime, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
      { ...runtime, entryPoints: ['server/src/server.ts'], outfile: 'dist/server.js' },
    ];

if (watch) {
  for (const target of targets) {
    const ctx = await context(target);
    await ctx.watch();
  }
  console.log('[esbuild] watching for changes...');
} else {
  await Promise.all(targets.map((target) => build(target)));
}

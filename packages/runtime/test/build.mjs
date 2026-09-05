/*
 * Bundles the worker for the integration fixture and places the runtime assets
 * beside it. Paths are resolved from this file, not the working directory, so
 * the suite runs the same from the package or from the repository root.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const here = import.meta.dirname;
const fixture = resolve(here, 'fixture');

await build({
  entryPoints: [resolve(here, '../src/worker/index.ts')],
  outfile: resolve(fixture, 'worker.js'),
  bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
  // pyodide.mjs is fetched at run time from indexUrl, never bundled.
  external: ['*/pyodide.mjs'],
});

// Served from the fixture's own directory so the test exercises the same
// same-origin arrangement production uses.
const pyodide = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));
const link = resolve(fixture, 'pyodide');
if (!existsSync(link)) symlinkSync(pyodide, link, 'dir');

mkdirSync(resolve(fixture, 'python'), { recursive: true });
cpSync(resolve(here, '../src/python/turtle.py'), resolve(fixture, 'python/turtle.py'));
console.log('bundled');

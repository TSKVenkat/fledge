/*
 * Puts the Python runtime and our turtle module where the web server can reach
 * them.
 *
 * Both are copies of things that live elsewhere in the workspace, so neither is
 * committed: a stale duplicate of turtle.py that disagrees with the one the
 * worker loads would be a genuinely confusing bug.
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const here = import.meta.dirname;

// Resolve pyodide THROUGH @fledge/runtime, which owns that dependency. Naming
// it here as well would let the served runtime drift from the one the worker
// was built against, which is a difficult bug to see.
const runtimePkg = createRequire(import.meta.url).resolve('@fledge/runtime/package.json');
const runtimeDir = dirname(runtimePkg);
const pyodide = dirname(createRequire(runtimePkg).resolve('pyodide/package.json'));
const turtle = resolve(runtimeDir, 'src/python/turtle.py');

const publicDir = resolve(here, '../public');
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(resolve(publicDir, 'python'), { recursive: true });

// Only the files the browser actually fetches; the package also ships types,
// source maps and a console demo that have no business being served.
mkdirSync(resolve(publicDir, 'pyodide'), { recursive: true });
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm',
                    'python_stdlib.zip', 'pyodide-lock.json']) {
  const from = resolve(pyodide, file);
  if (!existsSync(from)) throw new Error(`pyodide is missing ${file}; is it installed?`);
  cpSync(from, resolve(publicDir, 'pyodide', file));
}
cpSync(turtle, resolve(publicDir, 'python/turtle.py'));

// The embed script is generated too, so it cannot drift from its source.
execFileSync(process.execPath, [resolve(here, '../../../packages/embed/build.mjs')], { stdio: 'inherit' });
console.log('runtime assets placed in apps/web/public');

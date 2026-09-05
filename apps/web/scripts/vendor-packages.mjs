/*
 * Downloads Python package wheels so an instance works with no internet.
 *
 * The core runtime (wasm, standard library) is always served from your own
 * instance. Package wheels are not, because the pyodide npm package ships none
 * of them and the full set is hundreds of megabytes. This fetches only the
 * closure of the packages you name.
 *
 *   node apps/web/scripts/vendor-packages.mjs matplotlib numpy
 *
 * Then point the sandbox at them by adding to apps/web/frame.html:
 *   <meta name="fledge-packages" content="/pyodide/">
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const here = import.meta.dirname;
const runtimePkg = createRequire(import.meta.url).resolve('@fledge/runtime/package.json');
const pyodideDir = dirname(createRequire(runtimePkg).resolve('pyodide/package.json'));
const lock = JSON.parse(readFileSync(resolve(pyodideDir, 'pyodide-lock.json'), 'utf8'));
const version = lock.info?.version ?? JSON.parse(readFileSync(resolve(pyodideDir, 'package.json'), 'utf8')).version;
const cdn = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.error('Name at least one package, e.g. matplotlib.');
  process.exit(1);
}

/** Every package a request pulls in, resolved from the lock file. */
function closure(names) {
  const seen = new Set();
  const stack = [...names];
  while (stack.length > 0) {
    const name = stack.pop().toLowerCase();
    if (seen.has(name)) continue;
    const entry = lock.packages[name];
    if (!entry) { console.error(`Unknown package: ${name}`); process.exit(1); }
    seen.add(name);
    stack.push(...(entry.depends ?? []));
  }
  return [...seen];
}

const target = resolve(here, '../public/pyodide');
mkdirSync(target, { recursive: true });

let bytes = 0;
for (const name of closure(wanted).sort()) {
  const file = lock.packages[name].file_name;
  const destination = resolve(target, file);
  if (existsSync(destination)) { console.log(`  have  ${file}`); continue; }
  const response = await fetch(cdn + file);
  if (!response.ok) { console.error(`  FAIL  ${file} (${response.status})`); process.exit(1); }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  const size = Number(response.headers.get('content-length') ?? 0);
  bytes += size;
  console.log(`  got   ${file}  ${(size / 1048576).toFixed(2)} MB`);
}
console.log(`\nVendored into apps/web/public/pyodide (${(bytes / 1048576).toFixed(1)} MB downloaded).`);
console.log('Add this to apps/web/frame.html to use them:');
console.log('  <meta name="fledge-packages" content="/pyodide/">');

import { build } from 'esbuild';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const result = await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, '../../apps/web/public/embed.js'),
  bundle: true, format: 'iife', target: 'es2020', minify: true, metafile: true,
});
const size = Object.values(result.metafile.outputs)[0].bytes;
console.log(`embed.js: ${size} bytes`);

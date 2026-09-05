/**
 * Entry point for the sandbox frame document.
 *
 * The worker is created here rather than inside the package so the bundler can
 * see the URL and emit the chunk; the package stays bundler-agnostic.
 */
import { startFrame } from '@fledge/runtime';

startFrame({
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  imageSlot: document.getElementById('images') as HTMLElement,
  pyodideUrl: '/pyodide/',
  pythonUrl: '/python/',
  createWorker: () =>
    new Worker(new URL('../../../packages/runtime/src/worker/index.ts', import.meta.url), {
      type: 'module',
    }),
});

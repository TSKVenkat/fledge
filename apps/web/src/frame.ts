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
  previewSlot: document.getElementById('preview') as HTMLElement,
  pyodideUrl: '/pyodide/',
  pythonUrl: '/python/',
  // Overridable at deploy time without a rebuild: put a <meta name="fledge-packages">
  // in frame.html, or vendor the wheels and point it at /pyodide/.
  packageBaseUrl:
    document.querySelector<HTMLMetaElement>('meta[name="fledge-packages"]')?.content ||
    'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/',
  createWorker: () =>
    new Worker(new URL('../../../packages/runtime/src/worker/index.ts', import.meta.url), {
      type: 'module',
    }),
});

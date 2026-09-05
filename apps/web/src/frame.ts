/**
 * Entry point for the sandbox frame document.
 *
 * The worker is created here rather than inside the package so the bundler can
 * see the URL and emit the chunk; the package stays bundler-agnostic.
 */
import { startFrame } from '@fledge/runtime';

const forced = new URL(location.href).searchParams.get('tier');

startFrame({
  forceTier: forced === 'batch' ? 'batch' : undefined,
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

// Registered from the sandbox frame, which is the only document that fetches
// the runtime. allow-same-origin on the frame is what permits this; an opaque
// origin cannot register a worker, which is one reason the sandbox is a real
// origin rather than an opaque one.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // A worker that fails to register costs a repeat download, nothing more.
  });
}

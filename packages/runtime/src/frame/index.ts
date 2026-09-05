/**
 * The sandbox frame.
 *
 * Served from the sandbox origin and embedded by the application — and, for an
 * embed, by a third party's page. It owns the worker and every drawing surface,
 * and forwards only text and events to whoever embedded it. Pixels stay here:
 * a turtle spiral is thousands of segments, and shipping them across an origin
 * boundary to be re-rendered would be both slow and a second renderer.
 */
import type { FrameToHost, FrameToWorker, HostToFrame, WorkerToFrame } from '../protocol.ts';
import { PROTOCOL_VERSION, isForSession } from '../protocol.ts';
import type { WithoutSession } from '../protocol.ts';
import { detectCapabilities } from '../capabilities.ts';
import { DisplayList } from './canvas.ts';

export interface FrameOptions {
  canvas: HTMLCanvasElement;
  imageSlot: HTMLElement;
  pyodideUrl: string;
  pythonUrl: string;
  createWorker: () => Worker;
}

export function startFrame(options: FrameOptions): void {
  const display = new DisplayList(options.canvas);
  const worker = options.createWorker();

  let sessionId: string | null = null;
  let hostOrigin: string | null = null;
  let runId = 0;
  let booted = false;

  /** Messages raised before the handshake are held, so a boot failure that
   *  happens early is still reported once a host connects. */
  const held: WithoutSession<FrameToHost>[] = [];

  const toHost = (message: WithoutSession<FrameToHost>) => {
    if (sessionId === null || hostOrigin === null || parent === window) {
      if (message.t === 'fatal') held.push(message);
      return;
    }
    parent.postMessage({ ...message, sessionId } as FrameToHost, hostOrigin);
  };
  const toWorker = (message: FrameToWorker) => worker.postMessage(message);

  // A window resize is not the only way the canvas changes size: the host may
  // hide and show the pane, which fires no resize event at all.
  addEventListener('resize', () => display.schedule());
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => display.schedule()).observe(options.canvas);
  }

  // A worker that fails to load or throws at the top level is otherwise
  // completely silent: no message ever arrives and the host waits forever.
  worker.addEventListener('error', (event: ErrorEvent) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
    toHost({ t: 'fatal', reason: `The sandbox failed to start: ${event.message}${where}` });
  });
  worker.addEventListener('messageerror', () => {
    toHost({ t: 'fatal', reason: 'The sandbox sent a message that could not be read.' });
  });

  worker.addEventListener('message', (event: MessageEvent<WorkerToFrame>) => {
    const m = event.data;
    switch (m.t) {
      case 'booted': {
        booted = true;
        const caps = detectCapabilities();
        toHost({ t: 'ready', v: PROTOCOL_VERSION, caps: { ...caps, python: m.python } });
        break;
      }
      case 'progress':
        toHost({ t: 'progress', phase: m.phase, label: m.label, loaded: m.loaded, total: m.total });
        break;
      case 'stdout':
        toHost({ t: 'stdout', runId: m.runId, text: m.text });
        break;
      case 'stderr':
        toHost({ t: 'stderr', runId: m.runId, text: m.text });
        break;
      case 'inputRequest':
        toHost({ t: 'inputRequest', runId: m.runId, requestId: m.requestId, prompt: m.prompt });
        break;
      case 'draw':
        display.add(m.ops);
        toHost({ t: 'draw', runId: m.runId, ops: m.ops });
        break;
      case 'image': {
        // matplotlib output: rendered here, and only announced to the host.
        // Copy so the Blob owns a plain ArrayBuffer; a Uint8Array over a
        // SharedArrayBuffer is not a valid BlobPart.
        const blob = new Blob([m.bytes.slice().buffer as ArrayBuffer], { type: m.mime });
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.alt = m.label ?? 'Figure';
        img.style.cssText = 'max-width:100%;display:block;margin:.5rem 0';
        options.imageSlot.appendChild(img);
        toHost({ t: 'image', runId: m.runId, mime: m.mime, bytes: m.bytes, label: m.label });
        break;
      }
      case 'error':
        toHost({ t: 'error', runId: m.runId, error: m.error });
        break;
      case 'exit':
        toHost({ t: 'exit', runId: m.runId, ok: m.ok, durationMs: m.durationMs });
        break;
      case 'fatal':
        toHost({ t: 'fatal', reason: m.reason });
        break;
      default:
        break;
    }
  });

  addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as HostToFrame | undefined;
    if (!data || typeof data !== 'object') return;

    // The first `hello` pins us to that parent for the rest of the session.
    if (data.t === 'hello' && sessionId === null) {
      sessionId = data.sessionId;
      hostOrigin = event.origin;
      toWorker({ t: 'boot', indexUrl: options.pyodideUrl, pythonUrl: options.pythonUrl });
      for (const pending of held.splice(0)) toHost(pending);
      return;
    }
    if (event.origin !== hostOrigin) return;
    if (sessionId === null || !isForSession(data, sessionId)) return;
    if (!booted && data.t !== 'dispose') return;

    switch (data.t) {
      case 'run':
        runId = data.runId;
        display.clear();
        options.imageSlot.replaceChildren();
        toWorker({ t: 'run', runId: data.runId, program: data.program });
        break;
      case 'stdin':
        toWorker({ t: 'stdin', requestId: data.requestId, line: data.line });
        break;
      case 'stop':
        // Unconditional: works with no isolation, no SharedArrayBuffer and no
        // JSPI, in every browser. The interpreter is replaced, not resumed.
        worker.terminate();
        toHost({ t: 'exit', runId, ok: false, durationMs: 0 });
        location.reload();
        break;
      case 'reset':
        location.reload();
        break;
      case 'dispose':
        worker.terminate();
        break;
      default:
        break;
    }
  });
}

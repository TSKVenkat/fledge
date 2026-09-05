/**
 * The host-side handle on a sandbox.
 *
 * It owns an iframe pointing at the sandbox origin and speaks the narrow
 * message union in protocol.ts. It deliberately knows nothing about React: the
 * application wraps `subscribe` in a hook and that is the whole integration.
 *
 * Two checks guard every inbound message — the origin must be the sandbox, and
 * the payload must carry the session nonce we generated. Origin alone is not
 * enough: any frame on a third-party page shares that page's origin.
 */
import type { FrameToHost, HostToFrame } from './protocol.ts';
import { PROTOCOL_VERSION, isForSession } from './protocol.ts';
import type { Program, Runner, RunnerCapabilities, RunnerEvent } from './types.ts';
import { reduce, initialState, type MachineState } from './machine.ts';

export interface RunnerOptions {
  /** Where the sandbox iframe is inserted. */
  mount: HTMLElement;
  /** Origin serving the sandbox frame, e.g. https://sandbox.example.net */
  sandboxOrigin: string;
  /** Path on that origin, so one deployment can serve several frame modes. */
  framePath?: string;
  title?: string;
}

const UNKNOWN: RunnerCapabilities = {
  tier: 'batch', blockingInput: false, interrupt: 'terminate', animation: 'replay',
  crossOriginIsolated: false, sharedArrayBuffer: false, jspi: false,
};

export function createRunner(options: RunnerOptions): Promise<Runner> {
  const sessionId = crypto.randomUUID();
  const listeners = new Set<(event: RunnerEvent) => void>();
  let state: MachineState = initialState;
  let capabilities: RunnerCapabilities = UNKNOWN;
  let runId = 0;
  let disposed = false;

  const iframe = document.createElement('iframe');
  iframe.src = `${options.sandboxOrigin}${options.framePath ?? '/frame'}`;
  iframe.title = options.title ?? 'Program output';
  // allow-same-origin is safe only because the frame is cross-origin with us;
  // it is required so the frame can use Cache Storage and a service worker.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('allow', 'cross-origin-isolated');
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block';
  options.mount.appendChild(iframe);

  const emit = (event: RunnerEvent) => { for (const l of listeners) l(event); };
  const advance = (event: Parameters<typeof reduce>[1]) => {
    const next = reduce(state, event);
    if (next.status !== state.status) { state = next; emit({ type: 'status', status: state.status }); }
    else state = next;
  };

  const send = (message: HostToFrame) => {
    iframe.contentWindow?.postMessage(message, options.sandboxOrigin);
  };

  return new Promise<Runner>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The sandbox did not start.')), 120_000);

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== options.sandboxOrigin) return;
      if (event.source !== iframe.contentWindow) return;
      if (!isForSession(event.data, sessionId)) return;
      const m = event.data as FrameToHost;

      switch (m.t) {
        case 'ready':
          clearTimeout(timer);
          capabilities = m.caps;
          advance({ type: 'booted' });
          emit({ type: 'capabilities', capabilities });
          resolve(runner);
          break;
        case 'progress':
          emit({ type: 'progress', phase: m.phase, label: m.label, loaded: m.loaded, total: m.total });
          break;
        // Output from a run the student already stopped is dropped rather than
        // appended; the console must not gain lines after Stop.
        case 'stdout':
          if (m.runId === state.runId) emit({ type: 'stdout', text: m.text });
          break;
        case 'stderr':
          if (m.runId === state.runId) emit({ type: 'stderr', text: m.text });
          break;
        case 'inputRequest':
          if (m.runId !== state.runId) break;
          advance({ type: 'inputRequest', requestId: m.requestId, prompt: m.prompt });
          emit({ type: 'inputRequest', requestId: m.requestId, prompt: m.prompt });
          break;
        case 'draw':
          if (m.runId === state.runId) emit({ type: 'draw', ops: m.ops });
          break;
        case 'image':
          if (m.runId === state.runId) emit({ type: 'image', mime: m.mime, bytes: m.bytes, label: m.label });
          break;
        case 'error':
          if (m.runId !== state.runId) break;
          emit({ type: 'error', error: m.error });
          break;
        case 'exit':
          if (m.runId !== state.runId) break;
          advance({ type: 'exit' });
          emit({ type: 'exit', ok: m.ok, durationMs: m.durationMs });
          break;
        case 'fatal':
          clearTimeout(timer);
          advance({ type: 'error' });
          emit({ type: 'error', error: { name: 'SandboxError', message: m.reason, traceback: m.reason } });
          break;
        default:
          break;
      }
    };

    addEventListener('message', onMessage);

    const runner: Runner = {
      get capabilities() { return capabilities; },
      subscribe(listener) {
        listeners.add(listener);
        // Replay current state to a late subscriber. The runner finishes
        // booting before createRunner's promise resolves, so a caller that
        // subscribes in .then() would otherwise never learn it is ready and
        // would leave the Run button disabled forever.
        listener({ type: 'status', status: state.status });
        if (capabilities !== UNKNOWN) listener({ type: 'capabilities', capabilities });
        return () => listeners.delete(listener);
      },
      async run(program: Program) {
        if (disposed) return;
        runId += 1;
        advance({ type: 'run', runId });
        if (state.runId !== runId) return;   // reducer refused; already running
        send({ t: 'run', sessionId, runId, program });
      },
      provideInput(requestId, line) {
        if (disposed) return;
        advance({ type: 'inputProvided' });
        send({ t: 'stdin', sessionId, runId: state.runId, requestId, line });
      },
      async stop() {
        if (disposed) return;
        advance({ type: 'stopRequested' });
        send({ t: 'stop', sessionId, runId: state.runId });
      },
      async reset() {
        if (disposed) return;
        send({ t: 'reset', sessionId });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        send({ t: 'dispose', sessionId });
        removeEventListener('message', onMessage);
        iframe.remove();
        listeners.clear();
        advance({ type: 'disposed' });
      },
    };

    iframe.addEventListener('load', () => {
      advance({ type: 'booting' });
      send({ t: 'hello', v: PROTOCOL_VERSION, sessionId });
    });
  });
}

/**
 * The vocabulary shared by every part of the runtime: the host application, the
 * sandbox frame it embeds, and the worker inside that frame.
 *
 * Nothing here imports a UI framework or touches the DOM. The React layer is a
 * thin hook over `Runner`, and the frame and worker are plain scripts.
 */

/** How much fidelity the current browser and page can actually deliver. */
export type Tier =
  /** Cross-origin isolated: SharedArrayBuffer, so `input()` blocks and a running
   *  program can be interrupted gracefully without losing the interpreter. */
  | 'isolated'
  /** JSPI (WebAssembly stack switching): `input()` still blocks, but a stop has
   *  to terminate the worker. This is what a third-party embed gets on Chromium
   *  and Firefox, and it needs no co-operation from the embedding page. */
  | 'suspending'
  /** Neither. Chiefly Safari inside someone else's page. Programs run to
   *  completion against a pre-supplied input buffer. */
  | 'batch';

export interface RunnerCapabilities {
  tier: Tier;
  /** False means the host must show the Input pane before Run rather than
   *  prompting mid-run. This single flag drives the whole degraded UI. */
  blockingInput: boolean;
  /** 'signal' preserves the interpreter; 'terminate' destroys and replaces it. */
  interrupt: 'signal' | 'terminate';
  /** 'replay' means drawing is buffered and animated after the program ends. */
  animation: 'live' | 'replay';
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  jspi: boolean;
  /** e.g. "3.14.2". Absent until the runtime has booted. */
  python?: string;
}

export type ProgramKind = 'python' | 'web';

export interface Program {
  kind: ProgramKind;
  /** Path -> contents. Paths are validated where they are accepted, in the API's project routes. */
  files: Record<string, string>;
  entry: string;
  /** Lines drained by `input()` when `blockingInput` is false. */
  stdin?: string;
}

export interface PythonError {
  name: string;
  message: string;
  /** Already stripped of our own harness frames, so line numbers match the
   *  editor gutter. A traceback pointing into the bootstrap is a bug report
   *  from a confused twelve-year-old. */
  traceback: string;
  line?: number;
}

export type RunnerStatus =
  | 'created' | 'loading' | 'idle' | 'running'
  | 'awaitingInput' | 'stopping' | 'error' | 'disposed';

export type RunnerEvent =
  | { type: 'status'; status: RunnerStatus }
  | { type: 'capabilities'; capabilities: RunnerCapabilities }
  | { type: 'progress'; phase: 'runtime' | 'package'; label: string; loaded: number; total: number | null }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'inputRequest'; requestId: number; prompt: string }
  | { type: 'draw'; ops: readonly DrawOp[] }
  | { type: 'image'; mime: string; bytes: Uint8Array; label?: string }
  | { type: 'error'; error: PythonError }
  | { type: 'exit'; ok: boolean; durationMs: number };

/**
 * Turtle and other drawing arrive as a retained display list rather than as
 * pixels. Retaining the ops is what lets the frame redraw on resize without
 * loss, export a picture, and — in the batch tier — replay the drawing with
 * delays after the program has already finished.
 */
export type DrawOp =
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { op: 'poly'; points: readonly number[]; fill: string }
  | { op: 'dot'; x: number; y: number; r: number; color: string }
  | { op: 'text'; x: number; y: number; text: string; color: string; font: string }
  | { op: 'bg'; color: string }
  | { op: 'clear' };

export interface Runner {
  readonly capabilities: RunnerCapabilities;
  /** Returns an unsubscribe function; that is all React needs. */
  subscribe(listener: (event: RunnerEvent) => void): () => void;
  run(program: Program): Promise<void>;
  /** `null` signals end of input. */
  provideInput(requestId: number, line: string | null): void;
  stop(): Promise<void>;
  /** Fresh interpreter, same frame. */
  reset(): Promise<void>;
  dispose(): void;
}

/**
 * Every message that crosses a trust boundary, in one file so the two sides
 * cannot drift.
 *
 * There are two hops and they differ in character:
 *
 *   host page  <-> sandbox frame    cross-origin, both sides untrusted
 *   sandbox frame <-> worker        same origin, trusted
 *
 * The host hop carries a `sessionId` on every message. Without it, any other
 * frame on a teacher's page could post a `run` at our frame and drive it.
 */
import type { DrawOp, Program, PythonError, RunnerCapabilities } from './types.ts';

export const PROTOCOL_VERSION = 1;

/**
 * `Omit` over a union collapses it to the common keys, which silently loses
 * every variant. Distributing over the union first keeps each member intact,
 * so the frame can build a message without restating the session id.
 */
export type WithoutSession<T> = T extends { sessionId: string } ? Omit<T, 'sessionId'> : never;

export type HostToFrame =
  | { t: 'hello'; v: number; sessionId: string }
  | { t: 'run'; sessionId: string; runId: number; program: Program }
  | { t: 'stdin'; sessionId: string; runId: number; requestId: number; line: string | null }
  | { t: 'stop'; sessionId: string; runId: number }
  | { t: 'reset'; sessionId: string }
  | { t: 'dispose'; sessionId: string };

export type FrameToHost =
  | { t: 'ready'; v: number; sessionId: string; caps: RunnerCapabilities }
  | { t: 'progress'; sessionId: string; phase: 'runtime' | 'package'; label: string; loaded: number; total: number | null }
  | { t: 'stdout'; sessionId: string; runId: number; text: string }
  | { t: 'stderr'; sessionId: string; runId: number; text: string }
  | { t: 'inputRequest'; sessionId: string; runId: number; requestId: number; prompt: string }
  | { t: 'draw'; sessionId: string; runId: number; ops: DrawOp[] }
  | { t: 'image'; sessionId: string; runId: number; mime: string; bytes: Uint8Array; label?: string }
  | { t: 'error'; sessionId: string; runId: number; error: PythonError }
  | { t: 'exit'; sessionId: string; runId: number; ok: boolean; durationMs: number }
  | { t: 'resize'; sessionId: string; height: number }
  | { t: 'fatal'; sessionId: string; reason: string };

/** frame -> worker */
export type FrameToWorker =
  | { t: 'boot'; indexUrl: string; pythonUrl: string; packageBaseUrl: string; forceBatch?: boolean }
  | { t: 'run'; runId: number; program: Program }
  | { t: 'stdin'; requestId: number; line: string | null };

/** worker -> frame */
export type WorkerToFrame =
  | { t: 'booted'; python: string; jspi: boolean; sab: boolean; isolated: boolean }
  | { t: 'progress'; phase: 'runtime' | 'package'; label: string; loaded: number; total: number | null }
  | { t: 'stdout'; runId: number; text: string }
  | { t: 'stderr'; runId: number; text: string }
  | { t: 'inputRequest'; runId: number; requestId: number; prompt: string }
  | { t: 'draw'; runId: number; ops: DrawOp[] }
  | { t: 'image'; runId: number; mime: string; bytes: Uint8Array; label?: string }
  | { t: 'error'; runId: number; error: PythonError }
  | { t: 'exit'; runId: number; ok: boolean; durationMs: number }
  | { t: 'fatal'; reason: string };

/**
 * A message is only acted on if it is shaped right AND carries our session.
 * Origin is checked separately by the transport; both are required.
 */
export function isForSession(message: unknown, sessionId: string): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as { t?: unknown; sessionId?: unknown };
  return typeof m.t === 'string' && m.sessionId === sessionId;
}

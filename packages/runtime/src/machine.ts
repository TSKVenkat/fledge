/**
 * The runner's state, as a reducer over an event union.
 *
 * Two rules, both learned the hard way in other codebases:
 *
 *   - An unknown or out-of-order transition returns the state unchanged rather
 *     than throwing. Events arrive from a worker that may be a few milliseconds
 *     behind the user; a late `stdout` after Stop should be ignored, not crash.
 *   - `runId` is compared by the caller before events reach here, so output
 *     from a run the student already stopped never reaches the console.
 */
import type { RunnerStatus } from './types.ts';

export interface MachineState {
  status: RunnerStatus;
  runId: number;
  /** Set while status is 'awaitingInput'; the host answers with this id. */
  pendingInput: { requestId: number; prompt: string } | null;
}

export type MachineEvent =
  | { type: 'booting' }
  | { type: 'booted' }
  | { type: 'run'; runId: number }
  | { type: 'inputRequest'; requestId: number; prompt: string }
  | { type: 'inputProvided' }
  | { type: 'stopRequested' }
  | { type: 'exit' }
  | { type: 'error' }
  | { type: 'disposed' };

export const initialState: MachineState = { status: 'created', runId: 0, pendingInput: null };

export function reduce(state: MachineState, event: MachineEvent): MachineState {
  // Disposed is terminal. Nothing revives a runner.
  if (state.status === 'disposed') return state;

  switch (event.type) {
    case 'booting':
      return state.status === 'created' ? { ...state, status: 'loading' } : state;

    case 'booted':
      return state.status === 'loading' ? { ...state, status: 'idle' } : state;

    case 'run':
      // Only from a settled state. A second Run while running is ignored; the
      // host disables the button, but the guard belongs here too.
      return state.status === 'idle' || state.status === 'error'
        ? { status: 'running', runId: event.runId, pendingInput: null }
        : state;

    case 'inputRequest':
      return state.status === 'running'
        ? { ...state, status: 'awaitingInput', pendingInput: { requestId: event.requestId, prompt: event.prompt } }
        : state;

    case 'inputProvided':
      return state.status === 'awaitingInput'
        ? { ...state, status: 'running', pendingInput: null }
        : state;

    case 'stopRequested':
      // Stop is legal while running OR while waiting for input — a student who
      // is asked an unexpected question must be able to give up.
      return state.status === 'running' || state.status === 'awaitingInput'
        ? { ...state, status: 'stopping', pendingInput: null }
        : state;

    case 'exit':
      // Reachable from 'stopping' too: terminate resolves as a normal exit.
      return state.status === 'running' || state.status === 'awaitingInput' || state.status === 'stopping'
        ? { ...state, status: 'idle', pendingInput: null }
        : state;

    case 'error':
      return state.status === 'loading' ||
        state.status === 'running' || state.status === 'awaitingInput' || state.status === 'stopping'
        ? { ...state, status: 'error', pendingInput: null }
        : state;

    case 'disposed':
      return { ...state, status: 'disposed', pendingInput: null };

    default:
      return state;
  }
}

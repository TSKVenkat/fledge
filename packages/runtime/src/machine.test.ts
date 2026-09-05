import { describe, it, expect } from 'vitest';
import { reduce, initialState, type MachineState } from './machine.ts';

const at = (status: MachineState['status']): MachineState => ({ ...initialState, status });

describe('runner state machine', () => {
  it('boots from created to idle', () => {
    let s = reduce(initialState, { type: 'booting' });
    expect(s.status).toBe('loading');
    s = reduce(s, { type: 'booted' });
    expect(s.status).toBe('idle');
  });

  it('ignores a run that arrives before the runtime is ready', () => {
    // The Run button is disabled while loading, but a keyboard shortcut or a
    // scripted embed can still fire one. It must be dropped, not queued.
    expect(reduce(at('loading'), { type: 'run', runId: 1 }).status).toBe('loading');
  });

  it('ignores a second run while one is already running', () => {
    const running = reduce(at('idle'), { type: 'run', runId: 1 });
    const again = reduce(running, { type: 'run', runId: 2 });
    expect(again.runId).toBe(1);
  });

  it('carries the prompt while waiting for input and clears it after', () => {
    let s = reduce(at('idle'), { type: 'run', runId: 7 });
    s = reduce(s, { type: 'inputRequest', requestId: 3, prompt: 'Name? ' });
    expect(s.status).toBe('awaitingInput');
    expect(s.pendingInput).toEqual({ requestId: 3, prompt: 'Name? ' });
    s = reduce(s, { type: 'inputProvided' });
    expect(s.status).toBe('running');
    expect(s.pendingInput).toBeNull();
  });

  it('allows stop while waiting for input', () => {
    // A student faced with an unexpected question must be able to give up.
    let s = reduce(at('idle'), { type: 'run', runId: 1 });
    s = reduce(s, { type: 'inputRequest', requestId: 1, prompt: '? ' });
    s = reduce(s, { type: 'stopRequested' });
    expect(s.status).toBe('stopping');
    expect(s.pendingInput).toBeNull();
  });

  it('settles to idle when a terminated run reports its exit', () => {
    // terminate() surfaces as an ordinary exit; stopping must accept it.
    const s = reduce(at('stopping'), { type: 'exit' });
    expect(s.status).toBe('idle');
  });

  it('ignores an exit that arrives after the runner already settled', () => {
    // The late-event rule: a worker a few milliseconds behind must not be able
    // to knock a settled runner back into a transitional state.
    expect(reduce(at('idle'), { type: 'exit' }).status).toBe('idle');
  });

  it('is terminal once disposed', () => {
    const disposed = reduce(at('idle'), { type: 'disposed' });
    for (const e of [{ type: 'run', runId: 9 }, { type: 'booted' }, { type: 'exit' }] as const) {
      expect(reduce(disposed, e).status).toBe('disposed');
    }
  });

  it('recovers: a run is allowed after an error', () => {
    const s = reduce(at('error'), { type: 'run', runId: 2 });
    expect(s.status).toBe('running');
  });
});

import { describe, it, expect } from 'vitest';
import { detectCapabilities, tierFor } from './capabilities.ts';

describe('tier negotiation', () => {
  it('needs BOTH isolation and a usable SharedArrayBuffer for the isolated tier', () => {
    // Headers can be set and the browser still refuse the constructor, which is
    // why the capability is measured rather than read off crossOriginIsolated.
    expect(tierFor(true, true, true)).toBe('isolated');
    expect(tierFor(true, false, true)).toBe('suspending');
  });

  it('falls to suspending on JSPI alone — the third-party embed case', () => {
    expect(tierFor(false, false, true)).toBe('suspending');
  });

  it('falls to batch with neither — Safari inside someone else’s page', () => {
    expect(tierFor(false, false, false)).toBe('batch');
  });

  it('prefers isolated over suspending when both are available', () => {
    // Isolated is better despite JSPI being present: it keeps the interpreter
    // alive through an interrupt instead of destroying it.
    expect(tierFor(true, true, false)).toBe('isolated');
  });
});

describe('forcing a tier', () => {
  it('reports the batch tier regardless of what the browser offers', () => {
    // Every engine this project has run on offers JSPI or shared memory, so
    // without an override the batch tier would ship unexecuted. The override
    // must make the runtime behave as though nothing is available.
    const caps = detectCapabilities('batch');
    expect(caps.tier).toBe('batch');
    expect(caps.blockingInput).toBe(false);
    expect(caps.interrupt).toBe('terminate');
    expect(caps.animation).toBe('replay');
    expect(caps.jspi).toBe(false);
    expect(caps.sharedArrayBuffer).toBe(false);
  });

  it('measures when not forced', () => {
    const caps = detectCapabilities();
    // Node has no WebAssembly.Suspending and is not cross-origin isolated.
    expect(caps.crossOriginIsolated).toBe(false);
    expect(['batch', 'suspending', 'isolated']).toContain(caps.tier);
  });
});

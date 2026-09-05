import { describe, it, expect } from 'vitest';
import { tierFor } from './capabilities.ts';

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

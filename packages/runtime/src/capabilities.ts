/**
 * Capabilities are MEASURED, never declared.
 *
 * Headers can be present and the browser still refuse a SharedArrayBuffer, and
 * `crossOriginIsolated` can be true while the constructor throws. Anything that
 * decides how the UI behaves is therefore probed, not inferred from config.
 */
import type { RunnerCapabilities, Tier } from './types.ts';

export function detectSharedArrayBuffer(): boolean {
  try {
    // Presence of the constructor is not enough — construct one.
    return typeof SharedArrayBuffer !== 'undefined' && new SharedArrayBuffer(1).byteLength === 1;
  } catch {
    return false;
  }
}

export function detectJspi(): boolean {
  // WebAssembly.Suspending is the stack-switching entry point; its presence is
  // what Pyodide's run_sync() relies on.
  return typeof (globalThis as { WebAssembly?: { Suspending?: unknown } }).WebAssembly?.Suspending === 'function';
}

export function tierFor(isolated: boolean, sab: boolean, jspi: boolean): Tier {
  if (isolated && sab) return 'isolated';
  if (jspi) return 'suspending';
  return 'batch';
}

export function detectCapabilities(): RunnerCapabilities {
  const isolated = globalThis.crossOriginIsolated === true;
  const sab = detectSharedArrayBuffer();
  const jspi = detectJspi();
  const tier = tierFor(isolated, sab, jspi);
  return {
    tier,
    blockingInput: tier !== 'batch',
    interrupt: tier === 'isolated' ? 'signal' : 'terminate',
    animation: tier === 'batch' ? 'replay' : 'live',
    crossOriginIsolated: isolated,
    sharedArrayBuffer: sab,
    jspi,
  };
}

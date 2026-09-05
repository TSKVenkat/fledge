/* Spike 6: how long until a student can press Run, on a slow machine.
   CPU throttled 4x and a Fast-3G network profile via the DevTools protocol.
   This is NOT a Chromebook; it is a desktop made slower, and the numbers say so. */
import { chromium } from 'playwright';

const EDITOR = new URL('/new', process.env.FLEDGE_URL ?? 'http://localhost:8080/').href;

async function measure(label, { cpu, network }) {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (network) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', network);
  }
  const t0 = Date.now();
  await p.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  const shell = Date.now() - t0;
  await p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; },
                          null, { timeout: 300000 });
  const ready = Date.now() - t0;
  // Warm: same context, so the HTTP cache holds the runtime.
  const t1 = Date.now();
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; },
                          null, { timeout: 300000 });
  const warm = Date.now() - t1;
  await b.close();
  console.log(`${label.padEnd(34)} shell ${String(shell).padStart(6)} ms   cold-to-Run ${String(ready).padStart(6)} ms   warm-to-Run ${String(warm).padStart(6)} ms`);
  return { shell, ready, warm };
}

// Fast 3G as Chrome DevTools defines it.
const fast3g = { offline: false, latency: 562.5, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 };
const results = {};
results.desktop = await measure('desktop, no throttling', { cpu: 1, network: null });
results.cpu4 = await measure('CPU 4x slower', { cpu: 4, network: null });
results.cpu4net = await measure('CPU 4x slower + Fast 3G', { cpu: 4, network: fast3g });

const budget = 15000;
const worst = results.cpu4net.ready;
console.log(`\nbudget for cold-to-Run: ${budget} ms;  worst case measured: ${worst} ms  -> ${worst <= budget ? 'inside budget' : 'OVER BUDGET: loading design becomes a first-class problem'}`);
process.exit(0);

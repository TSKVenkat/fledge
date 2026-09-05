/* The runtime must boot from cache once it has booted from the network.
   Boot once normally; then fail every request for the runtime and boot again. */
import { chromium } from 'playwright';

const SANDBOX = process.env.FLEDGE_SANDBOX ?? 'http://localhost:8081';
const EDITOR = new URL('/new', process.env.FLEDGE_URL ?? 'http://localhost:8080/').href;
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const runEnabled = (p) => p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; }, null, { timeout: 120000 });

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
try {
  await p.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await runEnabled(p);
  check('first boot, from the network', true);

  // Give the worker a moment to finish installing and putting into cache.
  await p.waitForTimeout(2500);
  const frame = p.frames().find(f => f.url().startsWith(SANDBOX));
  const registered = await frame.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  check('the sandbox registered a service worker', registered >= 1, `${registered} registration(s)`);
  const cached = await frame.evaluate(async () => {
    const c = await caches.open('fledge-runtime-v1'); return (await c.keys()).map(r => new URL(r.url).pathname.split('/').pop());
  });
  check('the runtime core is in the cache', cached.includes('pyodide.asm.wasm') && cached.includes('python_stdlib.zip'), cached.join(', '));

  // Now the network "goes away" for the runtime: every request for it fails.
  let blocked = 0;
  await ctx.route(/\/pyodide\/|cdn\.jsdelivr\.net\/pyodide/, (route) => { blocked++; void route.abort('internetdisconnected'); });
  const fresh = await ctx.newPage();
  await fresh.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await runEnabled(fresh);
  check('second boot succeeds with the runtime unreachable', true);
  check('nothing for the runtime reached the network', blocked === 0, `${blocked} request(s) escaped the cache`);

  await fresh.click('button.run');
  await fresh.waitForSelector('.ask input', { timeout: 60000 });
  check('and a program still runs', true);
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

/* The batch tier, in a real WebKit engine -- and the correction that running
   it produced.

   The design assumed Safari had no JSPI. WebKit 26.5 does, so a WebKit embed on
   a third-party page negotiates the suspending tier and prompts live, exactly
   like Chrome. That is asserted here as the real behaviour. The batch tier --
   the fallback for an engine with neither JSPI nor SharedArrayBuffer -- is then
   exercised by forcing it, because no engine to hand lacks both, and code that
   ships unexecuted is not a fallback. */
import { webkit } from 'playwright';
import { createServer } from 'node:http';
import { APP, SANDBOX, adminCookie, createProject, shareProject } from './lib/setup.mjs';

const BLOG_PORT = 8198;
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const PROGRAM = 'a = input("First? ")\nb = input("Second? ")\nprint("Sum:", int(a) + int(b))\nimport turtle\nt = turtle.Turtle()\nfor _ in range(4):\n    t.forward(60); t.right(90)\n';

const cookie = await adminCookie();
const project = await createProject(cookie, 'Adder', { 'main.py': PROGRAM });
const token = (await shareProject(cookie, project.id)).token;

const blog = createServer((req, res) => {
  const forced = req.url.includes('batch') ? '?tier=batch' : '';
  res.writeHead(200, { 'content-type': 'text/html' });
  // Written by hand rather than via embed.js so the tier switch can be on the URL.
  res.end(`<!doctype html><meta charset="utf-8"><h1>A page with no headers at all</h1>
<iframe src="${SANDBOX}/embed/${token}${forced}" style="width:100%;height:520px" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`);
}).listen(BLOG_PORT);

const b = await webkit.launch();
console.log('  engine:', b.version());
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));
const embedFrame = async () => (await p.locator('iframe').elementHandle()).contentFrame();
const paintedPixels = async () => {
  const inner = p.frames().find(f => f.url().includes('frame.html'));
  if (!inner) return -1;
  return inner.evaluate(() => { const c = document.getElementById('canvas'); if (!c) return -2;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
};

try {
  // --- what WebKit actually offers -------------------------------------------
  await p.goto(`${APP}/new`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; }, null, { timeout: 180000 });
  const caps = await p.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer !== 'undefined', jspi: typeof WebAssembly.Suspending === 'function' }));
  console.log('  editor page capabilities:', JSON.stringify(caps));
  check('WebKit boots Python', /Python 3\.14/.test(await p.locator('.badge').textContent()));
  check('WebKit 26.5 HAS JSPI -- the research assumption was wrong', caps.jspi === true);
  check('and grants SharedArrayBuffer under isolation', caps.coi && caps.sab);

  // --- an embed on a page with no headers: suspending tier, live prompt -------
  await p.goto(`http://127.0.0.1:${BLOG_PORT}/`, { waitUntil: 'domcontentloaded' });
  let f = await embedFrame();
  await f.waitForSelector('button.run:not([disabled])', { timeout: 180000 });
  check('the embed boots in WebKit on a third-party page', true);
  check('it negotiates the SUSPENDING tier: no Input box', await f.locator('.embed-note').count() === 0);
  await f.click('button.run');
  await f.waitForSelector('.ask input', { timeout: 60000 });
  check('and prompts live, exactly as Chrome does', true);
  await f.fill('.ask input', '20'); await f.press('.ask input', 'Enter');
  await f.waitForSelector('.ask input', { timeout: 30000 });
  await f.fill('.ask input', '22'); await f.press('.ask input', 'Enter');
  await f.waitForSelector('text=Sum: 42', { timeout: 60000 });
  check('a two-question program completes with live input', true);

  // --- the batch tier, forced: what an engine with neither would get ----------
  await p.goto(`http://127.0.0.1:${BLOG_PORT}/batch`, { waitUntil: 'domcontentloaded' });
  f = await embedFrame();
  await f.waitForSelector('button.run:not([disabled])', { timeout: 180000 });
  check('forced batch: an Input box is offered before Run', await f.locator('.embed-note textarea').count() === 1);
  check('and it explains itself to the reader', (await f.locator('.embed-note p').textContent()).includes('cannot pause a program'));
  const openHref = await f.locator('.embed-note a').getAttribute('href');
  check('with a link to run it interactively on the app origin', openHref?.startsWith(`${APP}/s/`) === true, openHref);
  await f.fill('.embed-note textarea', '20\n22');
  await f.click('button.run');
  await f.waitForSelector('text=Sum: 42', { timeout: 60000 });
  check('the program runs to completion from the pre-filled input', true);
  check('and never tried to prompt live', await f.locator('.ask input').count() === 0);
  await f.waitForTimeout(800);
  const px = await paintedPixels();
  check('the turtle drawing still appears in batch mode', px > 200, `${px} opaque pixels`);

  // --- running out of pre-filled input is explained, not a traceback ---------
  await p.goto(`http://127.0.0.1:${BLOG_PORT}/batch`, { waitUntil: 'domcontentloaded' });
  f = await embedFrame();
  await f.waitForSelector('button.run:not([disabled])', { timeout: 180000 });
  await f.fill('.embed-note textarea', '20');
  await f.click('button.run');
  await f.waitForSelector('text=asked for more input', { timeout: 60000 });
  check('too little input produces a sentence, not a traceback', true);
  await p.screenshot({ path: 'e2e/screenshot-webkit-batch.png' });
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); blog.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

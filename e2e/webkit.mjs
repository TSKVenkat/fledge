/* The batch tier, in a real WebKit engine.
   Safari has no JSPI. Where the page is not cross-origin isolated either -- an
   embed on a third-party site -- the runtime must fall to the batch tier: a
   pre-filled Input box instead of a live prompt, and the same program running
   to completion regardless. Every claim about Safari embeds rested on this
   until it ran. */
import { webkit } from 'playwright';
import { createServer } from 'node:http';

const APP = 'http://localhost:8080', SANDBOX = 'http://localhost:8081', BLOG_PORT = 8198;
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const login = await fetch(`${APP}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin@example.org', password: 'correct horse battery staple' }) });
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const project = await (await fetch(`${APP}/v1/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ title: 'Adder', files: { 'main.py': 'a = input("First? ")\nb = input("Second? ")\nprint("Sum:", int(a) + int(b))\nimport turtle\nt = turtle.Turtle()\nfor _ in range(4):\n    t.forward(60); t.right(90)\n' } }) })).json();
const shared = await (await fetch(`${APP}/v1/projects/${project.project.id}/shares`, { method: 'POST',
  headers: { 'content-type': 'application/json', cookie }, body: '{}' })).json();
const token = shared.share.token;

const blog = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><h1>A page with no headers at all</h1>
<script src="${SANDBOX}/embed.js" data-fledge="${token}" data-height="420"></script>`); }).listen(BLOG_PORT);

const b = await webkit.launch();
console.log('  engine:', b.version());
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));

try {
  // --- the editor on our own origin: isolated, so input() should block ------
  await p.goto(`${APP}/new`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; }, null, { timeout: 180000 });
  const badge = await p.locator('.badge').textContent();
  check('WebKit boots Python on the isolated editor page', /Python 3\.14/.test(badge ?? ''), badge?.trim());
  check('the isolated editor does NOT fall to batch input', !/batch input/.test(badge ?? ''), badge?.trim());
  const editorCaps = await p.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer !== 'undefined',
    jspi: typeof WebAssembly.Suspending === 'function' }));
  console.log('  editor page:', JSON.stringify(editorCaps));
  check('WebKit has no JSPI (the premise of the whole batch tier)', editorCaps.jspi === false);
  check('WebKit grants SharedArrayBuffer under isolation', editorCaps.coi === true && editorCaps.sab === true);

  // --- the same program embedded on a page with no headers: must be batch ---
  await p.goto(`http://127.0.0.1:${BLOG_PORT}/`, { waitUntil: 'domcontentloaded' });
  const frame = await (await p.locator('iframe').elementHandle()).contentFrame();
  await frame.waitForSelector('button.run:not([disabled])', { timeout: 180000 });
  check('the embed boots in WebKit on a third-party page', true);

  const input = await frame.locator('.embed-note textarea').count();
  check('WebKit embed negotiated the BATCH tier: an Input box is offered before Run', input === 1);
  check('and it explains itself to the reader',
    (await frame.locator('.embed-note p').textContent()).includes('cannot pause a program'));
  const openHref = await frame.locator('.embed-note a').getAttribute('href');
  check('with a link to run it interactively on the app origin', openHref?.startsWith(`${APP}/s/`) === true, openHref);

  await frame.fill('.embed-note textarea', '20\n22');
  await frame.click('button.run');
  await frame.waitForSelector('text=Sum: 42', { timeout: 60000 });
  check('the program ran to completion from the pre-filled input', true);
  const prompted = await frame.locator('.ask input').count();
  check('and never tried to prompt live (which WebKit could not honour here)', prompted === 0);

  // Drawing in batch mode: the turtle picture must still appear.
  await frame.waitForTimeout(800);
  const painted = await (async () => {
    const inner = p.frames().find(f => f.url().includes('frame.html'));
    if (!inner) return -1;
    return inner.evaluate(() => { const c = document.getElementById('canvas'); if (!c) return -2;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  })();
  check('the turtle drawing still appears in batch mode', painted > 200, `${painted} opaque pixels`);

  await p.screenshot({ path: 'e2e/screenshot-webkit-embed.png' });
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); blog.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

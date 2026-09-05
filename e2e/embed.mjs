/* Puts an embed on a page at a third origin — a stand-in for a teacher's blog —
   and checks a reader can run the program without that page co-operating. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';

const APP = 'http://localhost:8080';
const SANDBOX = 'http://localhost:8081';
const BLOG_PORT = 8199;

const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

// Sign in, make a project, share it.
const login = await fetch(`${APP}/v1/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin@example.org', password: 'correct horse battery staple' }),
});
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const project = await (await fetch(`${APP}/v1/projects`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ title: 'Times table', files: { 'main.py': 'n = input("Which table? ")\nfor i in range(1, 4):\n    print(i, "x", n, "=", i * int(n))\n' } }),
})).json();
const shared = await (await fetch(`${APP}/v1/projects/${project.project.id}/shares`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}',
})).json();
const token = shared.share.token;
check('a share link was minted', typeof token === 'string' && token.length > 20);

// A third-party page. No COOP, no COEP, no co-operation of any kind.
const blog = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Mrs Hall's blog</title>
<h1>Week 4 — times tables</h1>
<p>Have a go at changing the number.</p>
<script src="${SANDBOX}/embed.js" data-fledge="${token}" data-height="360"></script>
<p>Back to the lesson.</p>`);
}).listen(BLOG_PORT);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));

try {
  await p.goto(`http://127.0.0.1:${BLOG_PORT}/`, { waitUntil: 'domcontentloaded' });
  check('the host page is NOT cross-origin isolated', await p.evaluate(() => self.crossOriginIsolated) === false);
  check('the one-line script inserted an iframe', await p.locator('iframe').count() === 1);

  const frame = await (await p.locator('iframe').elementHandle()).contentFrame();
  await frame.waitForSelector('button.run:not([disabled])', { timeout: 120000 });
  check('the embed booted Python on a third-party page', true);

  await frame.click('button.run');
  await frame.waitForSelector('.ask input, .embed-note textarea', { timeout: 60000 });

  const interactive = await frame.locator('.ask input').count() > 0;
  check('the embed asks for input inline (blocking input, no isolation)', interactive);
  if (interactive) {
    await frame.fill('.ask input', '7');
    await frame.press('.ask input', 'Enter');
    await frame.waitForSelector('text=3 x 7 = 21', { timeout: 30000 });
    const transcript = await frame.locator('.console pre').textContent();
    check('the program ran to completion in the embed', transcript.includes('3 x 7 = 21'));
    // The prompt must precede the answer, or the transcript reads backwards.
    check('the transcript reads in the order it happened',
      transcript.indexOf('Which table?') < transcript.indexOf('1 x 7 = 7'),
      JSON.stringify(transcript.slice(0, 60)));
  }

  // The escape hatch must point at the APPLICATION origin. A relative link
  // landed on the sandbox, whose server fell through to a blank frame.
  const openHref = await frame.locator('.embed-open').getAttribute('href');
  check('the Open link leads to the app origin, not the sandbox',
    openHref !== null && openHref.startsWith(APP + '/s/'), openHref);

  // The iframe should have been resized by the height message.
  await p.waitForTimeout(800);
  const height = await p.locator('iframe').evaluate((el) => el.getBoundingClientRect().height);
  check('the embed reported its height to the host page', height > 200, Math.round(height) + 'px');

  // And the host page must remain sealed off from it.
  const reachable = await p.evaluate(() => {
    try { return document.querySelector('iframe').contentDocument !== null; } catch { return false; }
  });
  check('the host page cannot reach into the embed', reachable === false);

  await p.screenshot({ path: 'e2e/screenshot-embed.png' });
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); blog.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

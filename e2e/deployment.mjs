/* Drives the Docker deployment, not the dev server: two real origins, real
   headers, the built assets. This is the arrangement a school would run. */
import { chromium } from 'playwright';

const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080/';
// The editor with no account is at /new; the root is the sign-in page.
const EDITOR = new URL('/new', APP).href;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 220)));

const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

try {
  await p.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  check('the built application loads', await p.locator('.brand').isVisible());

  const config = await p.evaluate(() => fetch('/v1/config').then(r => r.json()));
  check('the API tells the browser where the sandbox is', !!config.sandboxUrl, config.sandboxUrl);
  check('the sandbox is a different origin from the app',
    new URL(config.sandboxUrl).origin !== new URL(APP).origin,
    `${new URL(config.sandboxUrl).origin} vs ${new URL(APP).origin}`);

  await p.waitForFunction(() => {
    const b = document.querySelector('button.run');
    return b && !b.disabled;
  }, null, { timeout: 120000 });
  check('the sandbox booted in the deployed stack', true);

  const badge = await p.locator('.badge').textContent();
  check('real CPython is running', /Python 3\.14/.test(badge ?? ''), JSON.stringify(badge));

  // The frame really is served from the sandbox origin, not the app's.
  const frame = p.frames().find(f => f.url().includes('frame.html'));
  check('the frame came from the sandbox origin', !!frame && !frame.url().startsWith(APP), frame?.url());

  await p.click('button.run');
  await p.waitForSelector('.ask input', { timeout: 60000 });
  await p.fill('.ask input', 'Grace');
  await p.press('.ask input', 'Enter');
  await p.waitForFunction(() => document.querySelector('.console pre')?.textContent?.includes('Hello, Grace'),
                          null, { timeout: 30000 });
  check('a student can run a program and answer its question', true);

  await p.click('.tabs button:nth-child(2)');
  await p.waitForTimeout(1200);
  const painted = await frame.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  check('the turtle drew on the deployed canvas', painted > 500, painted + ' opaque pixels');

  // The API is reachable through the same origin as the app.
  const health = await p.evaluate(() => fetch('/health').then(r => r.json()));
  check('the API is proxied on the app origin', health.status === 'ok');

  // And an anonymous project round-trips against the real database.
  const created = await p.evaluate(() => fetch('/v1/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Deployed', files: { 'main.py': 'print(7)' } }),
  }).then(r => r.json()));
  check('a project is stored in the real database', !!created.project?.id, created.project?.id);

  const reopened = await p.evaluate(({ id, token }) => fetch(`/v1/projects/${id}`, {
    headers: { 'x-edit-token': token },
  }).then(r => r.json()), { id: created.project.id, token: created.editToken });
  check('it reopens with its edit token', reopened.files?.['main.py'] === 'print(7)', JSON.stringify(reopened.files));

  await p.screenshot({ path: 'e2e/screenshot-deployed.png' });
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

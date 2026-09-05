/* A teacher makes a link from the editor; a stranger opens it, runs it, and
   takes a copy. Then a password link asks before opening. Against the stack. */
import { chromium } from 'playwright';

const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080';
const ADMIN = { id: 'admin@example.org', password: 'correct horse battery staple' };
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const b = await chromium.launch();
const teacher = await (await b.newContext()).newPage();
const stranger = await (await b.newContext()).newPage();
for (const p of [teacher, stranger]) p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));

try {
  await teacher.goto(APP, { waitUntil: 'domcontentloaded' });
  await teacher.fill('input[autocomplete="username"]', ADMIN.id);
  await teacher.fill('input[autocomplete="current-password"]', ADMIN.password);
  await teacher.click('button[type="submit"]');
  await teacher.waitForSelector('nav .brand', { timeout: 30000 });

  const created = await teacher.evaluate(() => fetch('/v1/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Greeting', files: { 'main.py': 'print("hello from a shared project")' } }),
  }).then(r => r.json()));
  await teacher.goto(`${APP}/p/${created.project.id}`, { waitUntil: 'domcontentloaded' });
  await teacher.waitForSelector('button:has-text("Share")', { timeout: 30000 });
  check('the owner is offered Share', true);

  await teacher.click('button:has-text("Share")');
  await teacher.waitForSelector('.sharepanel', { timeout: 20000 });
  await teacher.click('.sharepanel button:has-text("New link")');
  await teacher.waitForSelector('.sharepanel .list code', { timeout: 20000 });
  const url = (await teacher.locator('.sharepanel .list code').first().textContent()).trim();
  check('a link appears with its token shown', url.startsWith(`${APP}/s/`), url);

  // --- a stranger, no account -------------------------------------------
  await stranger.goto(url, { waitUntil: 'domcontentloaded' });
  await stranger.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('hello from a shared project'),
                                 null, { timeout: 60000 });
  check('the share page shows the code with no account', true);
  await stranger.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; },
                                 null, { timeout: 120000 });
  await stranger.click('button.run');
  await stranger.waitForFunction(() => document.querySelector('.console pre')?.textContent?.includes('hello from a shared project'),
                                 null, { timeout: 60000 });
  check('a stranger can run it', true);

  await stranger.click('button:has-text("Remix")');
  await stranger.waitForURL(/\/p\/[0-9a-f-]+$/, { timeout: 30000 });
  check('Remix takes a copy into the editor', true);
  const copyId = stranger.url().split('/p/')[1];
  const stored = await stranger.evaluate((id) => localStorage.getItem(`fledge.edit.${id}`), copyId);
  check('the copy’s edit token is kept in this browser', typeof stored === 'string' && stored.length > 20);
  await stranger.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('hello from a shared project'),
                                 null, { timeout: 60000 });
  check('the copy loads the shared code', true);

  // --- a password link -------------------------------------------------
  await teacher.fill('input[aria-label="Link password"]', 'open sesame please');
  await teacher.click('.sharepanel button:has-text("New password link")');
  await teacher.waitForFunction(() => document.querySelectorAll('.sharepanel .list li').length >= 2, null, { timeout: 20000 });
  const locked = (await teacher.locator('.sharepanel .list li').nth(1).locator('code').textContent()).trim();

  const other = await (await b.newContext()).newPage();
  await other.goto(locked, { waitUntil: 'domcontentloaded' });
  await other.waitForSelector('input[type="password"]', { timeout: 30000 });
  check('a password link asks before opening', true);
  await other.fill('input[type="password"]', 'wrong');
  await other.click('button:has-text("Open")');
  await other.waitForSelector('.bad', { timeout: 20000 });
  check('a wrong password is refused', true);
  await other.fill('input[type="password"]', 'open sesame please');
  await other.click('button:has-text("Open")');
  await other.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('hello from a shared project'),
                              null, { timeout: 60000 });
  check('the right password opens it', true);

  // --- revoke -----------------------------------------------------------
  await teacher.locator('.sharepanel .list li').first().locator('button:has-text("Revoke")').click();
  await teacher.waitForTimeout(800);
  const dead = await (await b.newContext()).newPage();
  await dead.goto(url, { waitUntil: 'domcontentloaded' });
  await dead.waitForSelector('.bad', { timeout: 30000 });
  check('a revoked link is not available', (await dead.locator('.bad').textContent()).includes('not available'));
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

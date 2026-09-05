/* A whole lesson, driven through the interface: a teacher makes a class and
   sets work, a child joins with the code off the board, does the work and
   hands it in, and the teacher sees it. Two browser contexts, no shared state
   beyond the running instance. */
import { chromium } from 'playwright';

const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080';
const ADMIN = { id: 'admin@example.org', password: 'correct horse battery staple' };

const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const b = await chromium.launch();
const teacher = await (await b.newContext()).newPage();
const student = await (await b.newContext()).newPage();
for (const p of [teacher, student]) p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));

async function signIn(page, identifier, password) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form.card input', { timeout: 30000 });
  await page.fill('input[autocomplete="username"]', identifier);
  await page.fill('input[autocomplete="current-password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('nav .brand', { timeout: 30000 });
}

try {
  // --- the teacher sets up -------------------------------------------------
  await signIn(teacher, ADMIN.id, ADMIN.password);
  check('a teacher can sign in', true);

  const className = 'Year 9 Computing';
  await teacher.fill('input[aria-label="New class name"]', className);
  await teacher.click('text=Create class');
  await teacher.waitForSelector('.joincode', { timeout: 20000 });
  const joinCode = (await teacher.locator('.joincode code').textContent()).trim();
  check('the class shows a join code', /^[A-Z2-9]{7}$/.test(joinCode), joinCode);

  // A starter project, made through the API the page would use.
  const starter = await teacher.evaluate(() => fetch('/v1/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Countdown', files: { 'main.py': 'for i in range(3, 0, -1):\n    print(i)\n' } }),
  }).then(r => r.json()));
  check('a starter project exists', !!starter.project?.id);

  await teacher.reload();
  await teacher.waitForSelector('.joincode');
  await teacher.fill('input[aria-label="Assignment title"]', 'Countdown');
  await teacher.selectOption('select[aria-label="Starter project"]', starter.project.id);
  await teacher.click('text=Set');
  await teacher.waitForSelector('text=draft', { timeout: 20000 });
  check('the assignment starts as a draft', true);

  await teacher.click('.list a:has-text("Countdown")');
  await teacher.waitForSelector('button:has-text("Publish to the class")', { timeout: 20000 });
  await teacher.click('button:has-text("Publish to the class")');
  await teacher.waitForSelector('text=published', { timeout: 20000 });
  check('the teacher can publish it', true);
  const assignmentUrl = teacher.url();

  // --- a register of accounts ---------------------------------------------
  await teacher.goBack();
  await teacher.waitForSelector('textarea');
  await teacher.fill('textarea', 'Ada Lovelace');
  await teacher.click('text=Create accounts');
  await teacher.waitForSelector('.passwords', { timeout: 20000 });
  const username = (await teacher.locator('.passwords tbody td:nth-child(2) code').first().textContent()).trim();
  const password = (await teacher.locator('.passwords tbody td:nth-child(3) code').first().textContent()).trim();
  check('a register creates an account with a printable password', !!username && password.length > 8, `${username} / ${password}`);
  check('the page says the passwords are shown only once',
    (await teacher.locator('.passwords .bad').textContent()).includes('only time'));

  // --- the student ---------------------------------------------------------
  // The printed password is not yet the child's own: the first thing they meet
  // is a page insisting they choose one, and nothing else is reachable first.
  await student.goto(APP, { waitUntil: 'domcontentloaded' });
  await student.waitForSelector('form.card input', { timeout: 30000 });
  await student.fill('input[autocomplete="username"]', username);
  await student.fill('input[autocomplete="current-password"]', password);
  await student.click('button[type="submit"]');
  await student.waitForSelector('text=Choose your own password', { timeout: 30000 });
  check('a printed password must be changed before anything else', true);
  check('the home page is not reachable around it', await student.locator('nav .brand').count() === 0);

  const ownPassword = 'my very own secret words';
  await student.fill('input[autocomplete="current-password"]', password);
  const fresh = student.locator('input[autocomplete="new-password"]');
  await fresh.nth(0).fill(ownPassword);
  await fresh.nth(1).fill(ownPassword);
  await student.click('button:has-text("Save and continue")');
  // Changing a password ends every session, so they sign in again -- with theirs.
  await student.waitForSelector('form.card input[autocomplete="username"]', { timeout: 30000 });
  check('changing it signs the student out everywhere', true);
  const old = await (async () => {
    await student.fill('input[autocomplete="username"]', username);
    await student.fill('input[autocomplete="current-password"]', password);
    await student.click('button[type="submit"]');
    await student.waitForSelector('.bad', { timeout: 20000 });
    return true;
  })();
  check('the printed password no longer works', old);
  await signIn(student, username, ownPassword);
  check('the new student can sign in with their own password', true);

  await student.fill('input[aria-label="Join code"]', joinCode.toLowerCase());  // as a child would type it
  await student.click('button:has-text("Join")');
  await student.waitForSelector(`text=${className}`, { timeout: 20000 });
  check('the student joins with the code off the board', true);

  await student.click(`text=${className}`);
  await student.waitForSelector('.list a:has-text("Countdown")', { timeout: 20000 });
  check('the student sees the published assignment', true);
  const codeVisible = await student.locator('.joincode').count();
  check('the student is not shown the join code', codeVisible === 0);

  await student.click('.list a:has-text("Countdown")');
  await student.waitForSelector('button:has-text("Start")', { timeout: 20000 });
  await student.click('button:has-text("Start")');
  await student.waitForURL(/\/p\/[0-9a-f-]+$/, { timeout: 30000 });
  check('starting the assignment opens the student’s own copy', true);

  await student.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('range(3, 0, -1)'),
                                null, { timeout: 60000 });
  check('their copy contains the starter code', true);

  await student.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; },
                                null, { timeout: 120000 });
  await student.click('button.run');
  await student.waitForFunction(() => document.querySelector('.console pre')?.textContent?.includes('1'),
                                null, { timeout: 60000 });
  check('the student can run their copy', true);

  await student.goto(assignmentUrl.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: 'domcontentloaded' });
  await student.waitForSelector('button:has-text("Hand in")', { timeout: 30000 });
  await student.click('button:has-text("Hand in")');
  await student.waitForSelector('text=submitted', { timeout: 20000 });
  check('the student can hand the work in', true);

  // --- the teacher sees it -------------------------------------------------
  await teacher.goto(assignmentUrl, { waitUntil: 'domcontentloaded' });
  await teacher.waitForSelector('table.grid', { timeout: 20000 });
  const rows = await teacher.locator('table.grid tbody tr').count();
  check('the grid lists the class', rows === 1, `${rows} row(s)`);
  const state = await teacher.locator('table.grid tbody .pill').textContent();
  check('the teacher sees it as submitted', state.trim() === 'submitted', state);
  check('the teacher can open the work', await teacher.locator('table.grid a:has-text("Open")').count() === 1);

  await teacher.screenshot({ path: 'e2e/screenshot-grid.png' });
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

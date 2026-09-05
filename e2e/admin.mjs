/* An administrator creates a teacher through the interface; the teacher signs
   in, is made to choose a password, signs in again with it, and can then run a
   class. Against the stack. */
import { chromium } from 'playwright';

const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080';
const ADMIN = { id: 'admin@example.org', password: 'correct horse battery staple' };
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const b = await chromium.launch();
const admin = await (await b.newContext()).newPage();
const teacher = await (await b.newContext()).newPage();

async function signIn(page, identifier, password) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form.card input', { timeout: 30000 });
  await page.fill('input[autocomplete="username"]', identifier);
  await page.fill('input[autocomplete="current-password"]', password);
  await page.click('button[type="submit"]');
}

const email = `hall-${Date.now()}@example.org`;
try {
  await signIn(admin, ADMIN.id, ADMIN.password);
  await admin.waitForSelector('text=People who can teach here', { timeout: 30000 });
  check('an administrator is offered the admin area', true);
  await admin.click('text=People who can teach here');
  await admin.waitForSelector('input[aria-label="First password"]', { timeout: 20000 });

  await admin.fill('input[aria-label="Name"]', 'Mr Hall');
  await admin.fill('input[aria-label="Email"]', email);
  await admin.fill('input[aria-label="First password"]', 'printed on a slip');
  await admin.click('button:has-text("Create")');
  await admin.waitForSelector(`text=${email}`, { timeout: 20000 });
  check('a teacher can be created from the interface', true);
  check('the list shows they have yet to sign in',
    (await admin.locator(`tr:has-text("${email}") td:nth-child(4)`).textContent()).includes('awaiting first sign-in'));

  await signIn(teacher, email, 'printed on a slip');
  await teacher.waitForSelector('text=Choose your own password', { timeout: 30000 });
  check('the new teacher must choose a password first', true);
  await teacher.fill('input[autocomplete="current-password"]', 'printed on a slip');
  const fresh = teacher.locator('input[autocomplete="new-password"]');
  await fresh.nth(0).fill('a password of my own choosing');
  await fresh.nth(1).fill('a password of my own choosing');
  await teacher.click('button:has-text("Save and continue")');
  await teacher.waitForSelector('form.card input[autocomplete="username"]', { timeout: 30000 });
  await signIn(teacher, email, 'a password of my own choosing');
  await teacher.waitForSelector('nav .brand', { timeout: 30000 });
  check('and then reaches the home page with it', true);

  await teacher.fill('input[aria-label="New class name"]', 'Made by a created teacher');
  await teacher.click('text=Create class');
  await teacher.waitForSelector('.joincode', { timeout: 20000 });
  check('a created teacher can run a class', true);

  const adminLink = await teacher.locator('text=People who can teach here').count();
  check('a teacher is not offered the admin area', adminLink === 0);
  await teacher.goto(`${APP}/admin`, { waitUntil: 'domcontentloaded' });
  await teacher.waitForSelector('nav .brand', { timeout: 20000 });
  check('and is turned away from it by URL', !teacher.url().endsWith('/admin'));

  // Disable them; their session must die on the next request.
  await admin.reload(); await admin.waitForSelector(`text=${email}`);
  await admin.locator(`tr:has-text("${email}") button:has-text("Disable")`).click();
  await admin.waitForSelector(`tr:has-text("${email}") td:has-text("disabled")`, { timeout: 20000 });
  await teacher.goto(APP, { waitUntil: 'domcontentloaded' });
  await teacher.waitForSelector('form.card input', { timeout: 30000 });
  check('a disabled teacher is signed out on their next request', true);
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

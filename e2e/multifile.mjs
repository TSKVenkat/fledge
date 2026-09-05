/* A project with more than one file, through the editor: add a helper, import
   it, run, save, reload -- and a web project whose HTML pulls in its own CSS and
   JS by relative reference. Against the stack. */
import { chromium } from 'playwright';

const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080';
const ADMIN = { id: 'admin@example.org', password: 'correct horse battery staple' };
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const runEnabled = (p) => p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; }, null, { timeout: 120000 });
const editorHas = (p, text) => p.waitForFunction((t) => document.querySelector('.cm-content')?.textContent?.includes(t), text, { timeout: 30000 });

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));

try {
  await p.goto(APP, { waitUntil: 'domcontentloaded' });
  await p.fill('input[autocomplete="username"]', ADMIN.id);
  await p.fill('input[autocomplete="current-password"]', ADMIN.password);
  await p.click('button[type="submit"]');
  await p.waitForSelector('nav .brand', { timeout: 30000 });

  // --- Python: a helper module -----------------------------------------------
  const created = await p.evaluate(() => fetch('/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Two files', files: { 'main.py': 'from helper import shout\nprint(shout("hi"))\n' } }) }).then(r => r.json()));
  await p.goto(`${APP}/p/${created.project.id}`, { waitUntil: 'domcontentloaded' });
  await editorHas(p, 'from helper import shout');
  check('the entry file is shown first', (await p.locator('.filetab[data-active="true"] button[role="tab"]').textContent()) === 'main.py');
  check('the entry file cannot be removed', await p.locator('.filetab[data-active="true"] .close').count() === 0);

  await p.click('.filetabs button:has-text("+ file")');
  await p.fill('input[aria-label="New file name"]', '../evil.py');
  await p.press('input[aria-label="New file name"]', 'Enter');
  check('a path that climbs out is refused in the editor', (await p.locator('.filetabs .bad').textContent()).includes('cannot go up'));
  await p.fill('input[aria-label="New file name"]', 'helper.py');
  await p.press('input[aria-label="New file name"]', 'Enter');
  await p.waitForSelector('.filetab[data-active="true"] button:has-text("helper.py")', { timeout: 10000 });
  check('a new file opens as the active tab', true);

  await p.click('.cm-content');
  await p.keyboard.type('def shout(s):\n    return s.upper() + "!"\n');
  await runEnabled(p);
  await p.click('button.run');
  await p.waitForFunction(() => document.querySelector('.console pre')?.textContent?.includes('HI!'), null, { timeout: 60000 });
  check('main.py imports the helper and runs', true);

  await p.click('button:has-text("Save")');
  await p.waitForSelector('button:has-text("Saved")', { timeout: 20000 });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.filetab button:has-text("helper.py")', { timeout: 30000 });
  await p.click('.filetab button:has-text("helper.py")');
  await editorHas(p, 'def shout(s)');
  check('both files survive a save and a reload', true);
  check('the language switch is fixed for a saved project', await p.locator('.kinds button[disabled]').count() === 1);

  // --- Web: relative CSS and JS ----------------------------------------------
  await p.goto(`${APP}/new`, { waitUntil: 'domcontentloaded' });
  await p.click('.kinds button:nth-child(2)');
  await p.waitForSelector('.filetab button:has-text("style.css")', { timeout: 10000 });
  check('the web starter is three files', await p.locator('.filetab').count() === 3);
  await runEnabled(p);
  await p.click('button.run');
  await p.waitForTimeout(2500);
  const preview = p.frames().find(f => f.url() === 'about:srcdoc');
  check('the page rendered', !!preview);
  if (preview) {
    check('style.css was applied through a relative href',
      (await preview.locator('h1').evaluate((el) => getComputedStyle(el).color)) === 'rgb(45, 108, 223)');
    check('app.js ran through a relative src', (await preview.locator('#out').textContent()) === 'Hello, everyone!');
  }
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

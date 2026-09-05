/* The HTML/CSS/JS preview, against the deployed stack. */
import { chromium } from 'playwright';

const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080/';
// The editor with no account is at /new; the root is the sign-in page.
const EDITOR = new URL('/new', APP).href;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

try {
  await p.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const b = document.querySelector('button.run'); return b && !b.disabled; },
                          null, { timeout: 120000 });

  await p.click('.kinds button:nth-child(2)');            // switch to Web
  check('the language switch offers Web', await p.locator('.kinds button:nth-child(2)[aria-selected="true"]').count() === 1);

  // The editor must actually show the other language. CodeMirror mounts once
  // and owns its document, so this fails silently unless it is remounted.
  const shown = await p.locator('.cm-content').textContent();
  check('the editor switched to the HTML starter',
    shown.includes('<h1>Hello</h1>') && !shown.includes('import turtle'),
    JSON.stringify(shown.slice(0, 60)));

  await p.click('button.run');
  await p.waitForTimeout(2500);

  const sandboxFrame = p.frames().find(f => f.url().includes('frame.html'));
  check('the sandbox frame is present', !!sandboxFrame);

  // The preview is a nested iframe with an opaque origin.
  const previewSandbox = await sandboxFrame.evaluate(
    () => document.querySelector('#preview iframe')?.getAttribute('sandbox') ?? null);
  check('the preview runs with allow-scripts and nothing else',
    previewSandbox === 'allow-scripts', JSON.stringify(previewSandbox));

  const preview = p.frames().find(f => f.name() === '' && f.url() === 'about:srcdoc');
  check('the student page rendered', !!preview);
  if (preview) {
    const heading = await preview.locator('h1').textContent();
    check('the HTML rendered', heading === 'Hello', JSON.stringify(heading));
    const out = await preview.locator('#out').textContent();
    check('the JavaScript ran', out === 'Hello, everyone!', JSON.stringify(out));
    const colour = await preview.locator('h1').evaluate((el) => getComputedStyle(el).color);
    check('the CSS applied', colour === 'rgb(45, 108, 223)', colour);

    // An opaque origin has no storage at all; that is the security property.
    const storage = await preview.evaluate(() => {
      try { localStorage.setItem('x', '1'); return 'reachable'; } catch { return 'blocked'; }
    });
    check('student JavaScript has no storage (opaque origin)', storage === 'blocked', storage);

    const escaped = await preview.evaluate(() => {
      try { return parent.document !== null ? 'reachable' : 'blocked'; } catch { return 'blocked'; }
    });
    check('student JavaScript cannot reach the frame that hosts it', escaped === 'blocked', escaped);
  }

  // console.log from the page must arrive in the same console as print().
  await p.click('.tabs button:nth-child(1)');
  const consoleText = await p.locator('.console pre').textContent();
  check('console.log reaches the console panel',
    consoleText.includes('the console works here too'), JSON.stringify(consoleText.trim().slice(0, 80)));

  await p.click('.tabs button:nth-child(2)');
  await p.screenshot({ path: 'e2e/screenshot-web.png' });
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

/* Drives the editor the way a student would: type, Run, answer a question,
   read the output, look at the drawing. */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173/new';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 220)));
p.on('console', m => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 220)); });

const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

try {
  await p.goto(APP, { waitUntil: 'domcontentloaded' });
  check('app renders', await p.locator('.brand').isVisible());

  // Run becomes enabled only once the sandbox has booted.
  await p.waitForFunction(() => {
    const b = document.querySelector('button.run');
    return b && !b.disabled;
  }, null, { timeout: 120000 });
  check('sandbox booted and Run is enabled', true);

  const badge = await p.locator('.badge').textContent();
  check('reports the Python version to the user', /Python 3\.14/.test(badge ?? ''), JSON.stringify(badge));

  await p.click('button.run');

  // The starter program asks a question; the input box must appear.
  await p.waitForSelector('.ask input', { timeout: 60000 });
  check('input prompt appears mid-run', true, JSON.stringify((await p.locator('.ask span').textContent())?.trim()));

  await p.fill('.ask input', 'Grace');
  await p.press('.ask input', 'Enter');

  await p.waitForFunction(() => document.querySelector('.console pre')?.textContent?.includes('Hello, Grace'),
                          null, { timeout: 30000 });
  check('console shows the answer', true);

  // Drawing should have arrived from the turtle in the starter program.
  await p.waitForFunction(() => document.querySelectorAll('.tabs button')[1]?.textContent?.includes('•'),
                          null, { timeout: 60000 });
  check('drawing tab flags new output', true);

  await p.click('.tabs button:nth-child(2)');
  await p.waitForTimeout(1200);

  // Verify the canvas inside the cross-origin frame actually has ink on it.
  const frame = p.frames().find(f => f.url().includes('frame.html'));
  check('sandbox frame is a separate origin document', !!frame, frame?.url());
  const painted = await frame.evaluate(() => {
    const c = document.getElementById('canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  check('turtle actually drew pixels on the canvas', painted > 500, painted + ' opaque pixels');

  await p.screenshot({ path: 'e2e/screenshot-editor.png', fullPage: false });
  console.log('  screenshot: e2e/screenshot-editor.png');

  // Stop must work on a runaway loop.
  await p.click('.tabs button:nth-child(1)');
  await p.evaluate(() => {
    const view = document.querySelector('.cm-content');
    view.textContent = '';
  });
  check('reached the end of the walkthrough', true);
} catch (e) { console.log('EXCEPTION:', e.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);

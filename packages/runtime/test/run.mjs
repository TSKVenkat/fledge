import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
// Always rebuild. Running the suite against a stale bundle cost a debugging
// cycle once; it will not do so again.
execFileSync(process.execPath, [import.meta.dirname + '/build.mjs'], { stdio: 'inherit' });
import { spawn } from 'node:child_process';
const PORT = 8761;
const srv = spawn('python3', [import.meta.dirname + '/server.py', String(PORT)],
                  { cwd: import.meta.dirname + '/fixture', stdio: 'inherit' });
const done = (c) => { srv.kill(); process.exit(c); };
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 250)));
const R = []; const check = (n, ok, d = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const evs = () => p.evaluate(() => window.__r.events);
const waitExit = (n) => p.waitForFunction((n) => window.__r.events.filter(e => e.t === 'exit').length >= n, n, { timeout: 60000 });

try {
  await p.goto(`http://127.0.0.1:${PORT}/index.html`);
  await p.waitForFunction(() => window.__r.booted || window.__r.fatal, null, { timeout: 90000 });
  const fatal = await p.evaluate(() => window.__r.fatal);
  if (fatal) { console.log('FATAL:', fatal); done(1); }
  const booted = await p.evaluate(() => window.__r.booted);
  check('worker boots Pyodide', !!booted.python, 'CPython ' + booted.python);

  // 1. stdout
  await p.evaluate(() => window.__run({ 'main.py': 'print("hello")\nprint(2 + 2)' }, 'main.py'));
  await waitExit(1);
  let e = await evs();
  const out1 = e.filter(x => x.t === 'stdout').map(x => x.text).join('');
  check('prints to stdout', out1.includes('hello') && out1.includes('4'), JSON.stringify(out1.trim()));

  // 2. blocking input
  await p.evaluate(() => { window.__answers = ['Ada']; window.__run({ 'main.py': 'n = input("Name? ")\nprint("Hi", n)' }, 'main.py'); });
  await waitExit(2);
  e = await evs();
  check('blocking input() round-trips', e.some(x => x.t === 'stdout' && x.text.includes('Hi Ada')));
  // The prompt must arrive as a message, not as stdout: batched stdout held a
  // prompt written with end="" until after the answer had been echoed.
  const prompts = e.filter(x => x.t === 'inputRequest');
  check('the prompt arrives with the request, not in stdout',
    prompts.at(-1)?.prompt === 'Name? ', JSON.stringify(prompts.at(-1)?.prompt));
  check('the prompt is not also written to stdout',
    !e.filter(x => x.t === 'stdout').map(x => x.text).join('').includes('Name?'),
    JSON.stringify(e.filter(x => x.t === 'stdout').map(x => x.text).join('')));

  // 3. turtle emits a retained display list
  await p.evaluate(() => window.__run({ 'main.py': 'import turtle\nt = turtle.Turtle()\nfor _ in range(4):\n    t.forward(50)\n    t.right(90)\n' }, 'main.py'));
  await waitExit(3);
  e = await evs();
  const ops = e.filter(x => x.t === 'draw').flatMap(x => x.ops);
  check('turtle emits line ops', ops.filter(o => o.op === 'line').length === 4, `${ops.length} ops`);
  const sq = ops.filter(o => o.op === 'line');
  check('square closes back at the origin',
    Math.abs(sq.at(-1).x2) < 1e-6 && Math.abs(sq.at(-1).y2) < 1e-6,
    JSON.stringify([sq.at(-1).x2, sq.at(-1).y2]));

  // 4. turtle fill
  await p.evaluate(() => window.__run({ 'main.py': 'import turtle\nt=turtle.Turtle()\nt.fillcolor("red")\nt.begin_fill()\nfor _ in range(3):\n    t.forward(40); t.left(120)\nt.end_fill()\n' }, 'main.py'));
  await waitExit(4);
  e = await evs();
  check('begin_fill/end_fill emits a polygon', e.filter(x => x.t === 'draw').flatMap(x => x.ops).some(o => o.op === 'poly' && o.fill === '#ff0000' || o.op === 'poly' && o.fill === 'red'));

  // 5. traceback points at the student's line, not our harness
  await p.evaluate(() => window.__run({ 'main.py': 'x = 1\ny = x / 0\n' }, 'main.py'));
  await waitExit(5);
  e = await evs();
  const err = e.filter(x => x.t === 'error').at(-1);
  check('reports a clean ZeroDivisionError', err?.error.name === 'ZeroDivisionError', JSON.stringify(err?.error?.name));
  check('error message is non-empty and readable', /division by zero/i.test(err?.error.message ?? ''), JSON.stringify(err?.error?.message));
  check('traceback carries the student line number', err?.error.line === 2, 'line=' + err?.error.line);
  // The earlier version of this test grepped for two frame names and passed
  // while Pyodide's CodeRunner frames were still leaking through. Assert on
  // everything a student must never see.
  const tb = err?.error.traceback ?? '';
  check('traceback starts at the student\'s own frame',
    /^Traceback \(most recent call last\):\n\s+File "main\.py"/.test(tb), JSON.stringify(tb.slice(0, 90)));
  check('traceback names the student file', /main\.py/.test(tb), JSON.stringify(tb.slice(0, 100)));
  for (const leak of ['CodeRunner', 'run_async', '_pyodide', 'importlib', '/lib/python', '<exec>', '_fledge_run']) {
    check(`traceback does not leak "${leak}"`, !tb.includes(leak), JSON.stringify(tb.slice(0, 140)));
  }

  // 6. unsupported turtle call is explained, not a raw crash
  await p.evaluate(() => window.__run({ 'main.py': 'import turtle\nturtle.onkey(lambda: None, "a")\n' }, 'main.py'));
  await waitExit(6);
  e = await evs();
  const err2 = e.filter(x => x.t === 'error').at(-1);
  check('unsupported turtle feature names itself', /not available here yet/.test(err2?.error.message ?? ''), JSON.stringify(err2?.error?.message));

  // 7. multi-file import
  await p.evaluate(() => window.__run({ 'main.py': 'from helper import twice\nprint(twice(21))', 'helper.py': 'def twice(n):\n    return n * 2\n' }, 'main.py'));
  await waitExit(7);
  e = await evs();
  check('imports a second file from the project', e.some(x => x.t === 'stdout' && x.text.includes('42')));

  // 8. batch-tier stdin buffer
  await p.evaluate(() => window.__run({ 'main.py': 'a=input()\nb=input()\nprint(int(a)+int(b))' }, 'main.py', '20\n22'));
  await waitExit(8);
  e = await evs();
  check('pre-supplied stdin is drained when provided', e.some(x => x.t === 'stdout' && x.text.includes('42')));
} catch (err) { console.log('EXCEPTION:', err.message); R.push(false); }
finally { await b.close(); }
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
done(R.every(Boolean) ? 0 : 1);

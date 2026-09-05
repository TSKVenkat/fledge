import { useEffect, useRef, useState } from 'react';
import { Editor } from './Editor.tsx';
import { useRunner } from './use-runner.ts';

const WEB_STARTER = `<!-- Press Run, or Ctrl+Enter. -->
<h1>Hello</h1>
<p id="out">…</p>

<style>
  body { font: 16px system-ui; padding: 1rem; }
  h1 { color: #2d6cdf; }
</style>

<script>
  const names = ["world", "everyone", "class"];
  document.getElementById("out").textContent = "Hello, " + names[1] + "!";
  console.log("the console works here too");
</script>
`;

const STARTER = `# Press Run, or Ctrl+Enter.
name = input("What is your name? ")
print("Hello,", name)

import turtle
t = turtle.Turtle()
t.pencolor("#2d6cdf")
for i in range(36):
    t.forward(90)
    t.right(170)
`;

/**
 * Where the sandbox lives is an instance decision, not a build-time one: it is
 * a different port in the Docker stack and a different host name in a real
 * deployment, and an operator should be able to move it without a toolchain.
 * The API therefore tells us, and the development fallback keeps the two
 * origins apart locally so the boundary is exercised there too.
 */
function developmentSandboxOrigin(): string {
  const { protocol, hostname, port } = location;
  const other = hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return `${protocol}//${other}${port ? ':' + port : ''}`;
}

async function loadSandboxOrigin(): Promise<string> {
  try {
    const response = await fetch('/v1/config', { credentials: 'same-origin' });
    if (response.ok) {
      const config = await response.json() as { sandboxUrl?: string };
      if (config.sandboxUrl) return new URL(config.sandboxUrl).origin;
    }
  } catch {
    // No API reachable: this is the vite dev server on its own.
  }
  return developmentSandboxOrigin();
}

export function App() {
  const [kind, setKind] = useState<'python' | 'web'>('python');
  const [python, setPython] = useState(STARTER);
  const [web, setWeb] = useState(WEB_STARTER);
  const code = kind === 'python' ? python : web;
  const setCode = kind === 'python' ? setPython : setWeb;
  const [tab, setTab] = useState<'console' | 'canvas'>('console');
  const stage = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => { void loadSandboxOrigin().then(setOrigin); }, []);
  const runner = useRunner(stage, origin);
  const [answer, setAnswer] = useState('');

  const busy = runner.status === 'running' || runner.status === 'awaitingInput' || runner.status === 'stopping';
  const booting = runner.status === 'created' || runner.status === 'loading';

  const run = () => {
    if (kind === 'web') {
      // The page is the output, so show it rather than the console; anything
      // the page logs still arrives in the console tab.
      setTab('canvas');
      runner.run({ kind: 'web', files: { 'index.html': web }, entry: 'index.html' });
      return;
    }
    setTab('console');
    runner.run({ kind: 'python', files: { 'main.py': python }, entry: 'main.py' });
  };

  return (
    <div className="app">
      <header>
        <div className="brand">fledge</div>
        <div className="kinds" role="tablist" aria-label="Language">
          {(['python', 'web'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k}
                    onClick={() => { setKind(k); setTab(k === 'web' ? 'canvas' : 'console'); }}>
              {k === 'python' ? 'Python' : 'Web'}
            </button>
          ))}
        </div>
        <div className="actions">
          {busy
            ? <button className="stop" onClick={runner.stop}>Stop</button>
            : <button className="run" onClick={run} disabled={booting}>
                {booting ? 'Starting…' : 'Run'}
              </button>}
        </div>
        <div className="meta">
          {runner.capabilities && (
            <span className="badge" title={`tier: ${runner.capabilities.tier}`}>
              Python {runner.capabilities.python ?? '3'}
              {!runner.capabilities.blockingInput && ' · batch input'}
            </span>
          )}
        </div>
      </header>

      <main>
        <section className="pane">
          {/* Keyed on the language: CodeMirror owns its document and mounts
              once, so changing `value` alone would leave Python on screen after
              switching to Web. A different language is a different document, so
              remounting is the correct behaviour rather than a workaround. */}
          <Editor key={kind} value={code} onChange={setCode} onRun={run} />
        </section>

        <section className="pane output">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'console'} onClick={() => setTab('console')}>Console</button>
            <button role="tab" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')}>
              {kind === 'web' ? 'Page' : 'Drawing'}{runner.hasDrawing ? ' •' : ''}
            </button>
          </div>

          <div className="console" hidden={tab !== 'console'}>
            <pre>
              {runner.lines.map((line, i) => (
                <span key={i} className={line.kind}>{line.text}</span>
              ))}
            </pre>
            {runner.pendingInput && (
              /* A keydown handler, not a form. The embed runs inside a
                 sandboxed iframe without allow-forms, which blocks submission
                 before any handler runs; widening the sandbox to suit the UI
                 would be the wrong way round, so the UI does without. */
              <div className="ask">
              <span>{runner.pendingInput.prompt || '›'}</span>
              <input
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  runner.answer(answer);
                  setAnswer('');
                }}
                aria-label="Program input"
              />
            </div>
            )}
            {runner.progress && <div className="progress">{runner.progress}</div>}
          </div>

          {/* Always mounted: tearing the frame down to switch tabs would throw
              away a booted interpreter, and useRunner needs this element to
              exist from the first render. Hidden, never unmounted. */}
          <div className="stage" ref={stage} hidden={tab !== 'canvas'} />
        </section>
      </main>
    </div>
  );
}

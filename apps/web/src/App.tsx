import { useEffect, useRef, useState } from 'react';
import { Editor } from './Editor.tsx';
import { useRunner } from './use-runner.ts';

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
  const [code, setCode] = useState(STARTER);
  const [tab, setTab] = useState<'console' | 'canvas'>('console');
  const stage = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => { void loadSandboxOrigin().then(setOrigin); }, []);
  const runner = useRunner(stage, origin);
  const [answer, setAnswer] = useState('');

  const busy = runner.status === 'running' || runner.status === 'awaitingInput' || runner.status === 'stopping';
  const booting = runner.status === 'created' || runner.status === 'loading';

  const run = () => {
    setTab('console');
    runner.run({ kind: 'python', files: { 'main.py': code }, entry: 'main.py' });
  };

  return (
    <div className="app">
      <header>
        <div className="brand">fledge</div>
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
          <Editor value={code} onChange={setCode} onRun={run} />
        </section>

        <section className="pane output">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'console'} onClick={() => setTab('console')}>Console</button>
            <button role="tab" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')}>
              Drawing{runner.hasDrawing ? ' •' : ''}
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

          {/* The frame is always mounted: tearing it down to switch tabs would
              throw away a booted interpreter. It is hidden, never unmounted. */}
          <div className="stage" ref={stage} hidden={tab !== 'canvas'} />
        </section>
      </main>
    </div>
  );
}

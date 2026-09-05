import { useMemo, useRef, useState } from 'react';
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
 * In development the application is served from localhost and the sandbox from
 * 127.0.0.1. They are the same server but different origins, so the boundary is
 * exercised locally instead of only in production.
 */
function sandboxOrigin(): string {
  const { protocol, hostname, port } = location;
  const other = hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return `${protocol}//${other}${port ? ':' + port : ''}`;
}

export function App() {
  const [code, setCode] = useState(STARTER);
  const [tab, setTab] = useState<'console' | 'canvas'>('console');
  const stage = useRef<HTMLDivElement>(null);
  const origin = useMemo(() => sandboxOrigin(), []);
  const runner = useRunner(stage, origin);
  const [answer, setAnswer] = useState('');

  const busy = runner.status === 'running' || runner.status === 'awaitingInput' || runner.status === 'stopping';
  const booting = runner.status === 'created' || runner.status === 'loading';

  const run = () => {
    setTab('console');
    runner.run({ kind: 'python', files: { 'main.py': code }, entry: 'main.py' });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    runner.answer(answer);
    setAnswer('');
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
              <form className="ask" onSubmit={submit}>
                <span>{runner.pendingInput.prompt || '›'}</span>
                <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)}
                       aria-label="Program input" />
              </form>
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

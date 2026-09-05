import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Editor } from '../Editor.tsx';
import { useRunner } from '../use-runner.ts';
import { api, ApiError } from '../lib/api.ts';

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

export function EditorPage() {
  const { id } = useParams();
  const [title, setTitle] = useState('Untitled');
  const [saved, setSaved] = useState<'clean' | 'saving' | 'dirty' | 'error'>('clean');
  /**
   * Bumped whenever a document arrives from the server. CodeMirror owns its
   * text and mounts once, so a project loaded after the first render would
   * otherwise never appear: the editor sits showing the starter while the
   * right file is in state. Remounting is the correct response to "this is a
   * different document", and this is what makes it one.
   */
  const [documentKey, setDocumentKey] = useState(0);
  const [kind, setKind] = useState<'python' | 'web'>('python');
  const [python, setPython] = useState(STARTER);
  const [web, setWeb] = useState(WEB_STARTER);
  const code = kind === 'python' ? python : web;
  const setCode = (next: string) => {
    if (kind === 'python') setPython(next); else setWeb(next);
    if (id) setSaved('dirty');
  };
  const [tab, setTab] = useState<'console' | 'canvas'>('console');
  const stage = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => { void loadSandboxOrigin().then(setOrigin); }, []);
  const runner = useRunner(stage, origin);
  const [answer, setAnswer] = useState('');

  // An anonymous project's edit token lives in this browser and nowhere else:
  // it is what lets someone come back tomorrow without an account.
  const tokenKey = id ? `fledge.edit.${id}` : null;

  useEffect(() => {
    if (!id) return;
    const token = tokenKey ? (localStorage.getItem(tokenKey) ?? undefined) : undefined;
    void api.getProject(id, token)
      .then((loaded) => {
        setTitle(loaded.project.title);
        setKind(loaded.project.kind);
        const entry = loaded.project.settings.entry ?? (loaded.project.kind === 'web' ? 'index.html' : 'main.py');
        const body = loaded.files[entry] ?? Object.values(loaded.files)[0] ?? '';
        if (loaded.project.kind === 'web') setWeb(body); else setPython(body);
        setDocumentKey((n) => n + 1);
      })
      .catch((e: unknown) => { if (e instanceof ApiError) setSaved('error'); });
  }, [id, tokenKey]);

  const save = async () => {
    if (!id) return;
    setSaved('saving');
    const token = tokenKey ? (localStorage.getItem(tokenKey) ?? undefined) : undefined;
    const entry = kind === 'web' ? 'index.html' : 'main.py';
    try {
      await api.saveFiles(id, { [entry]: kind === 'web' ? web : python }, token);
      setSaved('clean');
    } catch { setSaved('error'); }
  };

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
          {id && (
            <>
              <span className="muted small">{title}</span>
              <button className="link" onClick={() => void save()} disabled={saved === 'saving'}>
                {saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Save' : saved === 'error' ? 'Save failed' : 'Saved'}
              </button>
            </>
          )}
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
          <Editor key={`${kind}-${documentKey}`} value={code} onChange={setCode} onRun={run} />
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

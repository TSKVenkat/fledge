/**
 * A shared project, opened from a link.
 *
 * This is where the embed sends a reader who wants the full experience, and it
 * is what a teacher hands out when they want a class to start from a worked
 * example. Nobody needs an account: Remix takes a copy as an anonymous project
 * whose edit token is kept in this browser.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Editor } from '../Editor.tsx';
import { Console } from '../Console.tsx';
import { useRunner } from '../use-runner.ts';
import { api, ApiError } from '../lib/api.ts';
import { loadSandboxOrigin } from '../lib/config.ts';

interface Shared {
  project: { id: string; title: string; kind: 'python' | 'web'; settings: { entry?: string } };
  share: { allowFork: boolean };
  files: Record<string, string>;
}

export function SharePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [shared, setShared] = useState<Shared | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'console' | 'canvas'>('console');
  const [origin, setOrigin] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const runner = useRunner(stage, origin);

  useEffect(() => { void loadSandboxOrigin().then(setOrigin); }, []);

  const load = () => {
    setError(null);
    api.getShared(token)
      .then((data) => {
        setShared(data);
        setLocked(false);
        const entry = data.project.settings.entry ?? (data.project.kind === 'web' ? 'index.html' : 'main.py');
        setCode(data.files[entry] ?? Object.values(data.files)[0] ?? '');
        setTab(data.project.kind === 'web' ? 'canvas' : 'console');
      })
      .catch((e: unknown) => {
        // A distinct code, so a locked link asks for a password rather than
        // looking like a dead one.
        if (e instanceof ApiError && e.code === 'PASSWORD_REQUIRED') { setLocked(true); return; }
        setError(e instanceof ApiError ? e.message : 'That link is not available.');
      });
  };
  useEffect(load, [token]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await fetch(`/v1/shares/${token}/unlock`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
      }).then((r) => { if (!r.ok) throw new Error('That password did not match.'); });
      setPassword('');
      load();
    } catch (e) { setError((e as Error).message); }
  };

  const entry = shared?.project.settings.entry ?? (shared?.project.kind === 'web' ? 'index.html' : 'main.py');
  const run = () => {
    if (!shared) return;
    setTab(shared.project.kind === 'web' ? 'canvas' : 'console');
    runner.run({ kind: shared.project.kind, files: { ...shared.files, [entry]: code }, entry });
  };

  const remix = async () => {
    try {
      const forked = await api.forkShared(token);
      // The token is what lets this browser come back to the copy tomorrow.
      if (forked.editToken) localStorage.setItem(`fledge.edit.${forked.project.id}`, forked.editToken);
      navigate(`/p/${forked.project.id}`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not take a copy.'); }
  };

  if (locked) {
    return (
      <div className="centred">
        <form className="card narrow" onSubmit={unlock}>
          <h2>This needs a password</h2>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required /></label>
          {error && <p className="bad">{error}</p>}
          <button className="run" type="submit">Open</button>
        </form>
      </div>
    );
  }
  if (error && !shared) return <div className="centred"><p className="bad">{error}</p></div>;

  const busy = runner.status === 'running' || runner.status === 'awaitingInput' || runner.status === 'stopping';
  const booting = runner.status === 'created' || runner.status === 'loading';

  return (
    <div className="app">
      <header>
        <a className="brand" href="/">fledge</a>
        <span className="muted">{shared?.project.title ?? '…'}</span>
        <div className="actions">
          {busy
            ? <button className="stop" onClick={runner.stop}>Stop</button>
            : <button className="run" onClick={run} disabled={booting || !shared}>{booting ? 'Starting…' : 'Run'}</button>}
          {shared?.share.allowFork && <button onClick={() => void remix()}>Remix</button>}
        </div>
        <div className="meta">
          {runner.capabilities && <span className="badge">Python {runner.capabilities.python ?? '3'}</span>}
        </div>
      </header>
      <main>
        <section className="pane">
          {shared && <Editor key={shared.project.id} value={code} onChange={setCode} onRun={run} />}
        </section>
        <section className="pane output">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'console'} onClick={() => setTab('console')}>Console</button>
            <button role="tab" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')}>
              {shared?.project.kind === 'web' ? 'Page' : 'Drawing'}{runner.hasDrawing ? ' •' : ''}
            </button>
          </div>
          <Console runner={runner} hidden={tab !== 'console'} />
          {/* Mounted from the first render: useRunner needs the element to exist. */}
          <div className="stage" ref={stage} hidden={tab !== 'canvas'} />
        </section>
      </main>
      {error && <p className="bad" style={{ padding: '0 1rem' }}>{error}</p>}
    </div>
  );
}

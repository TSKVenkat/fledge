import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Editor } from '../Editor.tsx';
import { useRunner } from '../use-runner.ts';
import { api, ApiError, type ShareLink } from '../lib/api.ts';
import { Console } from '../Console.tsx';
import { loadSandboxOrigin } from '../lib/config.ts';
import { useSession } from '../lib/session.tsx';

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
  const { user } = useSession();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Only the owner is offered sharing: an anonymous project has nobody to be
  // accountable for the link, and a share on someone else's work is refused
  // by the API anyway.
  const canShare = id !== undefined && user !== null && (ownerId === user.id || user.role === 'admin');
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

  // An anonymous project's edit token lives in this browser and nowhere else:
  // it is what lets someone come back tomorrow without an account.
  const tokenKey = id ? `fledge.edit.${id}` : null;

  useEffect(() => {
    if (!id) return;
    const token = tokenKey ? (localStorage.getItem(tokenKey) ?? undefined) : undefined;
    void api.getProject(id, token)
      .then((loaded) => {
        setTitle(loaded.project.title);
        setOwnerId(loaded.project.ownerId);
        setKind(loaded.project.kind);
        const entry = loaded.project.settings.entry ?? (loaded.project.kind === 'web' ? 'index.html' : 'main.py');
        const body = loaded.files[entry] ?? Object.values(loaded.files)[0] ?? '';
        if (loaded.project.kind === 'web') setWeb(body); else setPython(body);
        setDocumentKey((n) => n + 1);
      })
      .catch((e: unknown) => { if (e instanceof ApiError) setSaved('error'); });
  }, [id, tokenKey]);

  const loadShares = () => {
    if (!id || !canShare) return;
    api.listShares(id).then((r) => setShares(r.shares)).catch(() => setShares([]));
  };
  const share = async (visibility: 'link' | 'password', password?: string) => {
    if (!id) return;
    setShareError(null);
    try { await api.createShare(id, { visibility, password }); loadShares(); }
    catch (e) { setShareError(e instanceof ApiError ? e.message : 'Could not create a link.'); }
  };
  const revoke = async (shareId: string) => {
    try { await api.revokeShare(shareId); loadShares(); }
    catch (e) { setShareError(e instanceof ApiError ? e.message : 'Could not revoke that link.'); }
  };
  const openSharing = () => { setSharing((open) => !open); if (!sharing) loadShares(); };

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
              {/* The title is editable in place: renaming is the most common
                  thing done to a project after writing it, and a dialog for it
                  is one dialog too many. */}
              <input className="title" value={title} aria-label="Project title"
                     onChange={(e) => setTitle(e.target.value)}
                     onBlur={() => { if (id) void api.patchProject(id, { title: title.trim() || 'Untitled' },
                       tokenKey ? (localStorage.getItem(tokenKey) ?? undefined) : undefined).catch(() => setSaved('error')); }} />
              <button className="link" onClick={() => void save()} disabled={saved === 'saving'}>
                {saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Save' : saved === 'error' ? 'Save failed' : 'Saved'}
              </button>
              {canShare && <button className="link" onClick={openSharing} aria-expanded={sharing}>Share</button>}
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

      {sharing && canShare && (
        <SharePanel shares={shares} error={shareError}
                    onCreate={(v, pw) => void share(v, pw)} onRevoke={(sid) => void revoke(sid)} />
      )}

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

          <Console runner={runner} hidden={tab !== 'console'} />

          {/* Always mounted: tearing the frame down to switch tabs would throw
              away a booted interpreter, and useRunner needs this element to
              exist from the first render. Hidden, never unmounted. */}
          <div className="stage" ref={stage} hidden={tab !== 'canvas'} />
        </section>
      </main>
    </div>
  );
}


/**
 * Links are shown with their token because the API keeps a sealed copy for
 * exactly this purpose; revoking is immediate and the row stays, so a link
 * that stopped working can be explained rather than merely vanishing.
 */
function SharePanel({ shares, error, onCreate, onRevoke }: {
  shares: ShareLink[] | null;
  error: string | null;
  onCreate: (visibility: 'link' | 'password', password?: string) => void;
  onRevoke: (id: string) => void;
}) {
  const [password, setPassword] = useState('');
  const base = `${location.origin}/s/`;
  const live = (shares ?? []).filter((s) => s.revokedAt === null);

  return (
    <section className="sharepanel">
      <div className="row">
        <button className="run" onClick={() => onCreate('link')}>New link</button>
        <input placeholder="Password (optional)" value={password} aria-label="Link password"
               onChange={(e) => setPassword(e.target.value)} />
        <button disabled={!password} onClick={() => { onCreate('password', password); setPassword(''); }}>
          New password link
        </button>
      </div>
      {error && <p className="bad">{error}</p>}
      {shares === null ? <p className="muted small">Loading…</p>
        : live.length === 0 ? <p className="muted small">No links yet.</p>
        : (
          <ul className="list">
            {live.map((s) => (
              <li key={s.id}>
                <code className="code">{s.token ? base + s.token : '(token not shown)'}</code>
                <span className="pill">{s.visibility}</span>
                {s.token && (
                  <button className="link" onClick={() => void navigator.clipboard?.writeText(base + s.token)}>Copy</button>
                )}
                <button className="link" onClick={() => onRevoke(s.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      <p className="muted small">
        Anyone with a link can run and remix the project. Embed it with
        {' '}<code className="code">&lt;script src="…/embed.js" data-fledge="TOKEN"&gt;</code>.
      </p>
    </section>
  );
}

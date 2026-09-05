import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Editor } from '../Editor.tsx';
import { Console } from '../Console.tsx';
import { useRunner } from '../use-runner.ts';
import { api, ApiError, type ShareLink } from '../lib/api.ts';
import { loadSandboxOrigin } from '../lib/config.ts';
import { useSession } from '../lib/session.tsx';

type Kind = 'python' | 'web';
type Files = Record<string, string>;

const STARTERS: Record<Kind, { entry: string; files: Files }> = {
  python: {
    entry: 'main.py',
    files: {
      'main.py': `# Press Run, or Ctrl+Enter.
name = input("What is your name? ")
print("Hello,", name)

import turtle
t = turtle.Turtle()
t.pencolor("#2d6cdf")
for i in range(36):
    t.forward(90)
    t.right(170)
`,
    },
  },
  web: {
    entry: 'index.html',
    files: {
      'index.html': `<!-- Press Run, or Ctrl+Enter. -->
<link rel="stylesheet" href="style.css">
<h1>Hello</h1>
<p id="out">…</p>
<script src="app.js"></script>
`,
      'style.css': `body { font: 16px system-ui; padding: 1rem; }
h1 { color: #2d6cdf; }
`,
      'app.js': `const names = ["world", "everyone", "class"];
document.getElementById("out").textContent = "Hello, " + names[1] + "!";
console.log("the console works here too");
`,
    },
  },
};

/** The same rule the API enforces; a path the editor accepts and the API
 *  refuses is exactly the confusing failure this is meant to prevent. */
const PATH_RULE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
function pathProblem(path: string, existing: Files): string | null {
  if (!path) return 'Give the file a name.';
  if (path.length > 200) return 'That name is too long.';
  if (!PATH_RULE.test(path)) return 'Use letters, numbers, dots, dashes and slashes.';
  if (path.split('/').includes('..')) return 'Paths cannot go up a directory.';
  if (path in existing) return 'There is already a file with that name.';
  return null;
}

export function EditorPage() {
  const { id } = useParams();
  const { user } = useSession();

  const [kind, setKind] = useState<Kind>('python');
  const [files, setFiles] = useState<Files>(STARTERS.python.files);
  const [entry, setEntry] = useState(STARTERS.python.entry);
  const [active, setActive] = useState(STARTERS.python.entry);
  const [title, setTitle] = useState('Untitled');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [saved, setSaved] = useState<'clean' | 'saving' | 'dirty' | 'error'>('clean');
  const [tab, setTab] = useState<'console' | 'canvas'>('console');
  const [newPath, setNewPath] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  /**
   * Bumped whenever a document arrives from the server. CodeMirror owns its
   * text and mounts once; the editor is keyed on this and on the active file,
   * so both "the project loaded" and "a different tab" are the same thing to
   * it -- a different document, so remount.
   */
  const [documentKey, setDocumentKey] = useState(0);

  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const canShare = id !== undefined && user !== null && (ownerId === user.id || user.role === 'admin');

  const stage = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => { void loadSandboxOrigin().then(setOrigin); }, []);
  const runner = useRunner(stage, origin);

  // An anonymous project's edit token lives in this browser and nowhere else.
  const tokenKey = id ? `fledge.edit.${id}` : null;
  const token = () => (tokenKey ? (localStorage.getItem(tokenKey) ?? undefined) : undefined);

  useEffect(() => {
    if (!id) return;
    void api.getProject(id, token())
      .then((loaded) => {
        const k = loaded.project.kind;
        const e = loaded.project.settings.entry ?? STARTERS[k].entry;
        setTitle(loaded.project.title);
        setOwnerId(loaded.project.ownerId);
        setKind(k);
        setFiles(loaded.files);
        setEntry(e);
        setActive(e in loaded.files ? e : (Object.keys(loaded.files)[0] ?? e));
        setTab(k === 'web' ? 'canvas' : 'console');
        setDocumentKey((n) => n + 1);
      })
      .catch((e: unknown) => { if (e instanceof ApiError) setSaved('error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const switchKind = (k: Kind) => {
    if (k === kind || id) return;     // a saved project's kind is fixed
    setKind(k);
    setFiles(STARTERS[k].files);
    setEntry(STARTERS[k].entry);
    setActive(STARTERS[k].entry);
    setTab(k === 'web' ? 'canvas' : 'console');
    setDocumentKey((n) => n + 1);
  };

  const edit = (next: string) => {
    setFiles((f) => ({ ...f, [active]: next }));
    if (id) setSaved('dirty');
  };

  const addFile = () => {
    const path = (newPath ?? '').trim();
    const problem = pathProblem(path, files);
    if (problem) { setPathError(problem); return; }
    setFiles((f) => ({ ...f, [path]: '' }));
    setActive(path);
    setNewPath(null);
    setPathError(null);
    setDocumentKey((n) => n + 1);
    if (id) setSaved('dirty');
  };

  const removeFile = (path: string) => {
    if (path === entry) return;        // the entry point is what runs; it stays
    if (!confirm(`Remove ${path}?`)) return;
    setFiles((f) => { const next = { ...f }; delete next[path]; return next; });
    if (active === path) { setActive(entry); setDocumentKey((n) => n + 1); }
    if (id) setSaved('dirty');
  };

  const save = async () => {
    if (!id) return;
    setSaved('saving');
    try { await api.saveFiles(id, files, token()); setSaved('clean'); }
    catch { setSaved('error'); }
  };

  const run = () => {
    setTab(kind === 'web' ? 'canvas' : 'console');
    runner.run({ kind, files, entry });
  };

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

  const busy = runner.status === 'running' || runner.status === 'awaitingInput' || runner.status === 'stopping';
  const booting = runner.status === 'created' || runner.status === 'loading';
  const paths = Object.keys(files).sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)));

  return (
    <div className="app">
      <header>
        <a className="brand" href="/">fledge</a>
        <div className="kinds" role="tablist" aria-label="Language">
          {(['python', 'web'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} disabled={id !== undefined && kind !== k}
                    title={id ? 'A saved project keeps its language' : undefined}
                    onClick={() => switchKind(k)}>
              {k === 'python' ? 'Python' : 'Web'}
            </button>
          ))}
        </div>
        <div className="actions">
          {busy
            ? <button className="stop" onClick={runner.stop}>Stop</button>
            : <button className="run" onClick={run} disabled={booting}>{booting ? 'Starting…' : 'Run'}</button>}
        </div>
        <div className="meta">
          {id && (
            <>
              <input className="title" value={title} aria-label="Project title"
                     onChange={(e) => setTitle(e.target.value)}
                     onBlur={() => void api.patchProject(id, { title: title.trim() || 'Untitled' }, token()).catch(() => setSaved('error'))} />
              <button className="link" onClick={() => void save()} disabled={saved === 'saving'}>
                {saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Save' : saved === 'error' ? 'Save failed' : 'Saved'}
              </button>
              {canShare && <button className="link" onClick={openSharing} aria-expanded={sharing}>Share</button>}
            </>
          )}
          {runner.capabilities && (
            <span className="badge" title={`tier: ${runner.capabilities.tier}`}>
              Python {runner.capabilities.python ?? '3'}{!runner.capabilities.blockingInput && ' · batch input'}
            </span>
          )}
        </div>
      </header>

      {sharing && canShare && (
        <SharePanel shares={shares} error={shareError}
                    onCreate={(v, pw) => void share(v, pw)} onRevoke={(sid) => void revoke(sid)} />
      )}

      <main>
        <section className="pane files">
          <div className="filetabs" role="tablist" aria-label="Files">
            {paths.map((path) => (
              <span key={path} className="filetab" data-active={path === active}>
                <button role="tab" aria-selected={path === active}
                        onClick={() => { if (path !== active) { setActive(path); setDocumentKey((n) => n + 1); } }}>
                  {path}
                </button>
                {path !== entry && (
                  <button className="close" aria-label={`Remove ${path}`} onClick={() => removeFile(path)}>×</button>
                )}
              </span>
            ))}
            {newPath === null
              ? <button className="link" onClick={() => setNewPath('')}>+ file</button>
              : (
                <span className="newfile">
                  <input autoFocus value={newPath} placeholder="helper.py" aria-label="New file name"
                         onChange={(e) => { setNewPath(e.target.value); setPathError(null); }}
                         onKeyDown={(e) => { if (e.key === 'Enter') addFile(); if (e.key === 'Escape') { setNewPath(null); setPathError(null); } }} />
                  <button className="link" onClick={addFile}>Add</button>
                  {pathError && <span className="bad small">{pathError}</span>}
                </span>
              )}
          </div>
          <Editor key={`${active}-${documentKey}`} value={files[active] ?? ''} onChange={edit} onRun={run} />
        </section>

        <section className="pane output">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'console'} onClick={() => setTab('console')}>Console</button>
            <button role="tab" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')}>
              {kind === 'web' ? 'Page' : 'Drawing'}{runner.hasDrawing ? ' •' : ''}
            </button>
          </div>
          <Console runner={runner} hidden={tab !== 'console'} />
          {/* Always mounted: useRunner needs this element from the first render,
              and tearing it down would discard a booted interpreter. */}
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

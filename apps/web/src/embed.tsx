/**
 * The embeddable view.
 *
 * Served from the sandbox origin so a third-party page needs to change nothing
 * — no headers, no configuration, no co-operation. It runs the program in the
 * reader's own browser, reports its height so a listening host can size the
 * iframe, and offers a way out to the full editor when the browser cannot give
 * a blocking input().
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './Editor.tsx';
import { useRunner } from './use-runner.ts';
import { Console } from './Console.tsx';
import './styles.css';

interface Shared {
  project: { id: string; title: string; kind: 'python' | 'web'; settings: Record<string, unknown> };
  share: { allowFork: boolean; allowEmbed: boolean; embedOptions: Record<string, unknown> };
  files: Record<string, string>;
}

const token = () => location.pathname.replace(/^\/embed\//, '').replace(/\/$/, '');

function Embed() {
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  // The full editor lives on the APPLICATION origin, not this one. A relative
  // /s/ link from here would land on the sandbox, whose server falls through
  // to the bare frame -- a blank page where the escape hatch should be.
  const [appOrigin, setAppOrigin] = useState<string | null>(null);
  useEffect(() => {
    fetch('/v1/config').then((r) => r.json())
      .then((c: { publicUrl?: string }) => { if (c.publicUrl) setAppOrigin(new URL(c.publicUrl).origin); })
      .catch(() => setAppOrigin(null));
  }, []);
  const openUrl = appOrigin ? `${appOrigin}/s/${token()}` : null;
  const stage = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  // The frame is on this very origin, so the runner embeds a same-origin child.
  // ?tier=batch on the embed URL is passed through to the frame, so the
  // degraded path can be seen and tested on any browser.
  const forcedTier = new URL(location.href).searchParams.get('tier') === 'batch' ? '?tier=batch' : '';
  const runner = useRunner(stage, location.origin, `/frame.html${forcedTier}`);

  useEffect(() => {
    fetch(`/v1/shares/${token()}`)
      .then(async (response) => {
        if (response.status === 403) throw new Error('This example needs a password.');
        if (!response.ok) throw new Error('This example is not available.');
        return response.json() as Promise<Shared>;
      })
      .then((data) => {
        setShared(data);
        const entry = String(data.project.settings.entry ?? 'main.py');
        setCode(data.files[entry] ?? Object.values(data.files)[0] ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Tell whoever embedded us how tall we would like to be. A host that is not
  // listening simply ignores it, which is why the embed also works in a page
  // that cannot run scripts at all.
  useEffect(() => {
    if (!shell.current || parent === window) return;
    const report = () => parent.postMessage(
      { t: 'fledge:height', height: Math.ceil(shell.current!.scrollHeight) }, '*');
    report();
    const observer = new ResizeObserver(report);
    observer.observe(shell.current);
    return () => observer.disconnect();
  }, [shared]);

  // The stage is mounted unconditionally, below, even before the share has
  // loaded. Returning early here instead left useRunner's effect running
  // against a ref that was still null, and because its dependencies are the ref
  // object -- which never changes -- it never ran again once the element
  // appeared. The sandbox iframe was simply never created.
  const entry = String(shared?.project.settings.entry ?? 'main.py');
  const busy = runner.status === 'running' || runner.status === 'awaitingInput';
  const blocking = runner.capabilities?.blockingInput ?? true;

  const run = () => {
    if (!shared) return;
    runner.run({ kind: 'python', files: { ...shared.files, [entry]: code }, entry,
                 stdin: blocking ? undefined : stdin });
  };

  return (
    <div className="embed" ref={shell}>
      {(error || !shared) && (
        <div className="embed-message">{error ?? 'Loading…'}</div>
      )}
      {shared && !error && (
      <>
      <header className="embed-bar">
        <span className="embed-title">{shared.project.title}</span>
        {busy
          ? <button className="stop" onClick={runner.stop}>Stop</button>
          : <button className="run" onClick={run} disabled={!runner.capabilities}>Run</button>}
        {openUrl && (
          <a className="embed-open" href={openUrl} target="_blank" rel="noreferrer">
            Open ↗
          </a>
        )}
      </header>

      <div className="embed-panes">
        <Editor value={code} onChange={setCode} onRun={run} />
        <Console runner={runner} />
      </div>

      </>
      )}

      {/* Always mounted: this is where the sandbox iframe goes, and it must
          exist from the first render. Hidden until there is something to see. */}
      <div className="stage" ref={stage} hidden={!runner.hasDrawing} />

      {shared && !blocking && (
        <div className="embed-note">
          <label>
            Input
            <textarea value={stdin} onChange={(e) => setStdin(e.target.value)}
                      placeholder="One line per question this program asks" rows={2} />
          </label>
          <p>
            This browser cannot pause a program to ask a question, so fill the box
            above before pressing Run{openUrl ? <> — or{' '}
            <a href={openUrl} target="_blank" rel="noreferrer">run it interactively ↗</a></> : null}.
          </p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode><Embed /></StrictMode>,
);

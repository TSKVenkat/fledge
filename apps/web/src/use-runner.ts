/**
 * The only file that knows about both React and the runtime.
 *
 * Everything else in the application reads this state and calls run/stop, which
 * is what keeps @fledge/runtime free of React.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRunner, type Program, type Runner, type RunnerCapabilities, type RunnerStatus } from '@fledge/runtime';

export interface ConsoleLine { kind: 'out' | 'err' | 'prompt'; text: string }

export interface RunnerHook {
  status: RunnerStatus;
  capabilities: RunnerCapabilities | null;
  lines: ConsoleLine[];
  pendingInput: { requestId: number; prompt: string } | null;
  progress: string | null;
  hasDrawing: boolean;
  run(program: Program): void;
  stop(): void;
  answer(line: string): void;
  clear(): void;
}

/**
 * The `mount` element must be rendered UNCONDITIONALLY by the caller, from the
 * first render onwards. This effect depends on the ref object, which never
 * changes, so if the element is absent when it first runs the sandbox is never
 * created and nothing ever retries. An early `return <Loading/>` above the
 * mount point is enough to break it, silently.
 */
export function useRunner(mount: React.RefObject<HTMLElement | null>, sandboxOrigin: string | null): RunnerHook {
  const runnerRef = useRef<Runner | null>(null);
  const [status, setStatus] = useState<RunnerStatus>('created');
  const [capabilities, setCapabilities] = useState<RunnerCapabilities | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [pendingInput, setPendingInput] = useState<{ requestId: number; prompt: string } | null>(null);
  const [progress, setProgress] = useState<string | null>('Starting Python…');
  const [hasDrawing, setHasDrawing] = useState(false);

  useEffect(() => {
    if (!mount.current || sandboxOrigin === null) return;
    let disposed = false;
    let runner: Runner | null = null;

    createRunner({ mount: mount.current, sandboxOrigin, framePath: '/frame.html' })
      .then((r) => {
        if (disposed) { r.dispose(); return; }
        runner = r;
        runnerRef.current = r;
        setCapabilities(r.capabilities);
        setProgress(null);
        r.subscribe((event) => {
          switch (event.type) {
            case 'status': setStatus(event.status); break;
            case 'capabilities': setCapabilities(event.capabilities); break;
            case 'progress': setProgress(event.label); break;
            case 'stdout': setLines((l) => [...l, { kind: 'out', text: event.text }]); break;
            case 'stderr': setLines((l) => [...l, { kind: 'err', text: event.text }]); break;
            case 'inputRequest': setPendingInput({ requestId: event.requestId, prompt: event.prompt }); break;
            case 'draw': setHasDrawing(true); break;
            case 'image': setHasDrawing(true); break;
            case 'error':
              setLines((l) => [...l, { kind: 'err', text: event.error.traceback || event.error.message }]);
              break;
            case 'exit': setProgress(null); break;
            default: break;
          }
        });
      })
      .catch((err: Error) => setLines((l) => [...l, { kind: 'err', text: err.message }]));

    return () => { disposed = true; runner?.dispose(); runnerRef.current = null; };
  }, [mount, sandboxOrigin]);

  const run = useCallback((program: Program) => {
    setLines([]);
    setHasDrawing(false);
    setPendingInput(null);
    runnerRef.current?.run(program);
  }, []);

  const stop = useCallback(() => { runnerRef.current?.stop(); }, []);

  const answer = useCallback((line: string) => {
    setPendingInput((pending) => {
      if (pending) {
        // Echo the prompt and the answer together, so the transcript reads the
        // way a terminal session does. The prompt is deliberately not printed
        // by Python: batched stdout held it back until after the answer.
        setLines((l) => [...l, { kind: 'out', text: `${pending.prompt}${line}\n` }]);
        runnerRef.current?.provideInput(pending.requestId, line);
      }
      return null;
    });
  }, []);

  const clear = useCallback(() => setLines([]), []);

  return { status, capabilities, lines, pendingInput, progress, hasDrawing, run, stop, answer, clear };
}

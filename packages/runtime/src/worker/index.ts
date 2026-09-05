/**
 * The Pyodide worker. Student code executes here and nowhere else.
 *
 * A worker has no DOM: `js.document` does not resolve, so student Python cannot
 * reach the page even before any sandboxing is considered. Drawing leaves as a
 * list of operations we interpret; it is never handed a canvas.
 *
 * Pyodide 314 requires a MODULE worker — importScripts() fails outright with
 * "Classic web workers are not supported".
 */
import type { DrawOp, Program, PythonError } from '../types.ts';
import type { FrameToWorker, WorkerToFrame } from '../protocol.ts';

declare const self: DedicatedWorkerGlobalScope & {
  _fledge_emit?: (op: unknown) => void;
  _fledge_input?: (prompt: string) => Promise<string>;
};

interface PyodideApi {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  registerJsModule(name: string, module: object): void;
  loadPackage(names: string[]): Promise<void>;
  FS: { writeFile(path: string, data: string): void; mkdirTree(path: string): void };
  version: string;
}

let pyodide: PyodideApi | null = null;
let runId = 0;
let pendingInput: ((line: string) => void) | null = null;
let inputRequestId = 0;

/** Lines pre-supplied by the host, drained by input() in the batch tier. */
let stdinQueue: string[] = [];
let useBlockingInput = true;

/** Draw ops are batched per frame: a spiral is thousands of segments and one
 *  postMessage each would swamp the channel. */
let drawBuffer: DrawOp[] = [];
let drawTimer: ReturnType<typeof setTimeout> | null = null;

/** Set per run; Python calls this when the student's program raises. */
let reportError: (name: string, message: string, traceback: string, line: number | null) => void =
  () => {};

const post = (m: WorkerToFrame) => self.postMessage(m);

function flushDraw(): void {
  if (drawTimer !== null) { clearTimeout(drawTimer); drawTimer = null; }
  if (drawBuffer.length === 0) return;
  post({ t: 'draw', runId, ops: drawBuffer });
  drawBuffer = [];
}

function queueDraw(op: DrawOp): void {
  drawBuffer.push(op);
  if (drawBuffer.length >= 256) { flushDraw(); return; }
  if (drawTimer === null) drawTimer = setTimeout(flushDraw, 16);
}

/**
 * Errors are formatted inside Python, not scraped out of the JavaScript
 * exception. Pyodide wraps user code in its own CodeRunner frames, and a
 * regex over the message text leaks them into the student's console — which
 * was exactly the bug this replaced. `traceback` gives us structured frames,
 * so we can keep only the ones whose filename belongs to the project.
 */
function toPythonError(err: unknown): PythonError {
  const message = String((err as Error)?.message ?? err).trim();
  const lastLine = message.split('\n').filter(Boolean).pop() ?? message;
  const nameMatch = /(\w*(?:Error|Exception|Interrupt))\b/.exec(lastLine);
  return { name: nameMatch?.[1] ?? 'Error', message: lastLine, traceback: message };
}

/** Installed into Python as `input()`. */
async function requestInput(prompt: string): Promise<string> {
  if (!useBlockingInput) {
    // Batch tier: drain the pre-supplied buffer. Running out is a normal,
    // explainable condition, not an EOFError from deep inside the runtime.
    const next = stdinQueue.shift();
    if (next === undefined) {
      throw new Error(
        'This program asked for more input than the Input box provided. ' +
        'Add another line to the Input box and run it again.',
      );
    }
    return next;
  }
  const requestId = ++inputRequestId;
  post({ t: 'inputRequest', runId, requestId, prompt });
  return new Promise<string>((resolve) => { pendingInput = resolve; });
}

const BOOTSTRAP = `
import builtins, sys, io
from pyodide.ffi import run_sync
from js import _fledge_input

def _input(prompt=""):
    # The prompt is NOT printed here. Pyodide batches stdout by line, and a
    # prompt written with end="" has no newline, so it sat in the buffer until
    # the next print and appeared AFTER the answer the student had already
    # typed. It travels in the inputRequest message instead, and the host
    # echoes prompt and answer together once the answer is known.
    return run_sync(_fledge_input(prompt))

builtins.input = _input

# matplotlib must never try to open a window. Agg renders to a buffer, which is
# the only backend that works with no DOM at all.
import os
os.environ.setdefault("MPLBACKEND", "Agg")
`;

const RUNNER = `
import sys, traceback

def _fledge_run(path, report):
    """Execute the student's file and report failures in their terms.

    Frames belonging to the runtime are dropped, so the first line a student
    reads points at their own code. Keeping this in Python rather than parsing
    the JavaScript error is what makes that reliable.
    """
    src = open(path).read()
    g = {"__name__": "__main__", "__file__": "main.py"}
    try:
        exec(compile(src, "main.py", "exec"), g)
    except SystemExit:
        pass
    except BaseException as exc:
        # Drop every frame that is not the student's own code: the runtime's
        # own files, and this runner itself, which compiles as "<exec>".
        frames = [f for f in traceback.extract_tb(exc.__traceback__)
                  if not f.filename.startswith("/lib/")
                  and "_pyodide" not in f.filename
                  and f.filename != "<exec>"
                  and f.name != "_fledge_run"]
        body = "".join(traceback.format_list(frames))
        only = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        line = frames[-1].lineno if frames else None
        text = ("Traceback (most recent call last):\\n" + body + only) if body else only
        report(type(exc).__name__, only, text, line)
        return False
    return True
`;

const MPL_SHIM = `
import base64, io
import matplotlib
matplotlib.use("Agg", force=True)
import matplotlib.pyplot as _plt
from _fledge_draw import image as _image

def _show(*a, **k):
    buf = io.BytesIO()
    _plt.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    _image(base64.b64encode(buf.getvalue()).decode())
    _plt.clf()

_plt.show = _show
`;

async function boot(indexUrl: string, pythonUrl: string, packageBaseUrl: string): Promise<void> {
  post({ t: 'progress', phase: 'runtime', label: 'Starting Python', loaded: 0, total: null });
  const mod = await import(/* @vite-ignore */ `${indexUrl}pyodide.mjs`);
  pyodide = await mod.loadPyodide({
    indexURL: indexUrl,
    // The core (wasm, stdlib) is served from our own origin; package wheels are
    // not, because the pyodide npm package ships none of them and vendoring
    // every wheel would be a great deal of disk for packages most instances
    // never load. An operator who needs true offline use points this at their
    // own mirror -- see scripts/vendor-packages.mjs.
    packageBaseUrl,
    stdout: (text: string) => post({ t: 'stdout', runId, text: text + '\n' }),
    stderr: (text: string) => post({ t: 'stderr', runId, text: text + '\n' }),
  }) as PyodideApi;

  self._fledge_input = requestInput;

  pyodide.registerJsModule('_fledge_draw', {
    emit: (op: unknown) => {
      // Pyodide hands dicts across as proxies; take the plain object.
      const plain = (op as { toJs?: (o: object) => unknown }).toJs
        ? (op as { toJs: (o: object) => unknown }).toJs({ dict_converter: Object.fromEntries })
        : op;
      queueDraw(plain as DrawOp);
    },
    report: (name: string, message: string, traceback: string, line: number | null) =>
      reportError(name, message, traceback, line),
    image: (b64: string) => {
      flushDraw();
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      post({ t: 'image', runId, mime: 'image/png', bytes });
    },
  });

  await pyodide.runPythonAsync(BOOTSTRAP);
  await pyodide.runPythonAsync(RUNNER);
  // Expose the reporter under the name the Python runner expects.
  await pyodide.runPythonAsync('from _fledge_draw import report as _fledge_report');

  // Our turtle is fetched rather than embedded so an operator can read exactly
  // what is being imported into their students' interpreters.
  const turtleSrc = await (await fetch(`${pythonUrl}turtle.py`)).text();
  pyodide.FS.writeFile('/home/pyodide/turtle.py', turtleSrc);

  post({
    t: 'booted',
    python: String(pyodide.runPython('import sys; sys.version.split()[0]')),
    jspi: typeof (globalThis as { WebAssembly?: { Suspending?: unknown } }).WebAssembly?.Suspending === 'function',
    sab: typeof SharedArrayBuffer !== 'undefined',
    isolated: self.crossOriginIsolated === true,
  });
}

async function run(id: number, program: Program): Promise<void> {
  if (!pyodide) return;
  runId = id;
  stdinQueue = program.stdin ? program.stdin.split('\n') : [];
  const started = performance.now();
  try {
    // matplotlib is large and most programs never touch it, so it is loaded
    // only when the source actually mentions it.
    const source = program.files[program.entry] ?? '';
    if (/\bmatplotlib\b|\bpyplot\b/.test(source)) {
      post({ t: 'progress', phase: 'package', label: 'Loading matplotlib', loaded: 0, total: null });
      await pyodide.loadPackage(['matplotlib']);
      await pyodide.runPythonAsync(MPL_SHIM);
    }
    for (const [path, contents] of Object.entries(program.files)) {
      if (path !== program.entry) pyodide.FS.writeFile(`/home/pyodide/${path}`, contents);
    }
    pyodide.FS.writeFile('/home/pyodide/main.py', source);
    let failed = false;
    reportError = (name, message, traceback, line) => {
      failed = true;
      flushDraw();
      post({ t: 'error', runId: id, error: { name, message: message.trim(), traceback, line: line ?? undefined } });
    };
    await pyodide.runPythonAsync(
      `import sys\nsys.path.insert(0, "/home/pyodide")\n_fledge_run("/home/pyodide/main.py", _fledge_report)`,
    );
    flushDraw();
    post({ t: 'exit', runId: id, ok: !failed, durationMs: Math.round(performance.now() - started) });
  } catch (err) {
    flushDraw();
    post({ t: 'error', runId: id, error: toPythonError(err) });
    post({ t: 'exit', runId: id, ok: false, durationMs: Math.round(performance.now() - started) });
  }
}

self.onmessage = async (event: MessageEvent<FrameToWorker>) => {
  const msg = event.data;
  try {
    if (msg.t === 'boot') { await boot(msg.indexUrl, msg.pythonUrl, msg.packageBaseUrl); return; }
    if (msg.t === 'run') {
      useBlockingInput =
        typeof (globalThis as { WebAssembly?: { Suspending?: unknown } }).WebAssembly?.Suspending === 'function' ||
        typeof SharedArrayBuffer !== 'undefined';
      await run(msg.runId, msg.program);
      return;
    }
    if (msg.t === 'stdin') {
      const resolve = pendingInput;
      pendingInput = null;
      // `null` means end of input; Python sees an empty line.
      resolve?.(msg.line ?? '');
      return;
    }
  } catch (err) {
    post({ t: 'fatal', reason: String((err as Error)?.message ?? err) });
  }
};

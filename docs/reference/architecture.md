# Architecture

The single decision everything else follows from: **student code never executes
on the server.** Not in any language, at any version.

That is not a security posture. It is the economics. Trinket ran Python 2 in the
browser and gave it away; Python 3 needed real CPython on their servers and was
charged for. When they closed in August 2026 and published their source, nobody
picked it up — hosting it meant paying that bill. Their repository still carries
the shape of the problem in its directory names: a server-side container per
language.

Pyodide removes it. CPython 3.14 compiled to WebAssembly runs in the student's
own tab, so the marginal cost of a student running a program is zero.

## The shape

```
Application  (app.example.org)
  └── iframe → Sandbox  (sandbox.example.net)   ← a different HOST NAME
        └── Web Worker
              └── Pyodide / CPython 3.14
```

The application owns the editor, the console text and the account. The sandbox
owns every drawing surface. The worker owns the interpreter.

**Text crosses the boundary; pixels do not.** Console output is small and is
exactly what the application wants to style and turn into clickable error
locations. A turtle spiral is thousands of segments and a redraw is continuous —
shipping that across an origin boundary to be re-rendered would be both slow and
a second renderer to maintain.

## Why a worker, specifically

A Web Worker has no DOM. There is no `document`, no `window`, no cookie jar;
`js.document` does not resolve. Student Python therefore cannot reach the page
even before any sandbox attribute is considered, and drawing can only arrive as
data we interpret.

It also means the interpreter can be destroyed. `worker.terminate()` is an
unconditional Stop that works in every browser with no special headers, which is
what lets a runaway `while True:` be survivable everywhere.

## Capability tiers

Blocking `input()` needs the interpreter to suspend mid-call. There are two ways
to do that and they cover complementary browsers, so the runtime measures what
is available and negotiates a tier at boot.

| | Isolated | Suspending | Batch |
|---|---|---|---|
| Needs | cross-origin isolation | JSPI | nothing |
| Typically | the editor, on your origin | an embed on any current browser, Safari included | an embed on an older browser with neither JSPI nor shared memory |
| `input()` | blocks | blocks | reads a pre-filled box |
| Stop | graceful, interpreter survives | terminates the worker | terminates the worker |

**Batch is not broken.** The same program runs and draws the same picture; what
degrades is interactivity. Where drawing cannot be animated live it is buffered
and replayed afterwards, so a turtle picture still appears.

Capabilities are **measured, never assumed**. Headers can be present and a
browser still refuse a `SharedArrayBuffer`, so the runtime constructs one and
sees what happens rather than trusting `crossOriginIsolated`.

### Why isolation is not the foundation

Cross-origin isolation applies to a whole frame chain: a page embedding us would
have to opt in, and a teacher's blog never will. For a while that looked like it
capped embeds at the degraded tier.

It does not, for two reasons. JSPI gives a blocking `input()` inside a worker
with no isolation and no shared memory at all — and, contrary to the data this
design was first drawn from, WebKit has it too: a real WebKit 26.5 embed on a
headerless page prompts live. And Stop never depended on isolation, because
terminating a worker always works. Isolation buys a *graceful* interrupt that
keeps the interpreter alive — a real improvement, and an optional one.

The batch tier can be forced with `?tier=batch` on a frame or embed URL. That is
how it is tested, and how a teacher can see what a student on an older browser
would see.

## Errors

Tracebacks are formatted **inside Python**, not scraped from the JavaScript
exception. Pyodide wraps user code in its own frames, and a regular expression
over the message text leaks them into a child's console. Filtering structured
frames means the first line a student reads is their own:

```
Traceback (most recent call last):
  File "main.py", line 2, in <module>
    y = x / 0
        ~~^~~
ZeroDivisionError: division by zero
```

## Drawing

Drawing is a **retained display list**, not pixels. Keeping the operations means
a resize repaints without loss, a picture can be exported, and the batch tier can
replay a drawing after the program has finished. Operations are batched to one
message per animation frame, because a spiral is thousands of segments and one
message each would swamp the channel.

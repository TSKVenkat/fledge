# Security

## Reporting a vulnerability

Please report privately, via a GitHub security advisory on this repository.
Do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. A proof of concept
helps enormously. You will get an acknowledgement within a week.

## The threat model

The thing being defended is a school's installation and its students' accounts,
against code that a student wrote — which may be hostile, and will certainly be
careless.

### What isolates student code

Three layers, listed in the order they should be trusted.

1. **A separate origin.** The sandbox is served from a different host name to
   the application. It holds no session, sets no cookie, and stores nothing
   about anyone. If every other layer failed there would be nothing there worth
   taking.

   This must be a **host name, not a port**. Cookies ignore ports:
   `example.org:8081` can read `example.org`'s cookies. A second port is not an
   isolation boundary, and configuring one is a silent, total failure.

2. **No DOM.** Student Python runs in a Web Worker, which has no `document`, no
   `window` and no cookies. `js.document` does not resolve. Drawing arrives as a
   list of operations the frame interprets; Python is never handed a canvas.
   Hiding the `js` module would be cosmetic — `importlib` defeats it — so the
   worker boundary is the real one.

3. **The `sandbox` attribute.** The Python frame is
   `allow-scripts allow-same-origin`, which is safe only because the frame is
   cross-origin with its parent; `allow-same-origin` is needed for Cache Storage
   and the service worker. The HTML/JS preview gets `allow-scripts` alone, so it
   runs at an opaque origin with no storage at all.

### What a student can do

- Use all the processor and memory their own tab is allowed.
- Draw anything inside the output frame.
- Make network requests, unless the operator narrows `connect-src` on the
  sandbox route. Whether students should reach the network is a policy decision
  for the school, so it is configurable rather than decided here.

### What a student cannot do

- Read or write the application's cookies or session — different origin, and
  sessions are server-side rows behind an `HttpOnly` cookie.
- Reach the embedding page's DOM.
- Read another student's work: the sandbox origin stores nothing user-specific.
- Escape the HTML preview frame, which has an opaque origin.

### Known limits

- A student can hang their own tab with a tight loop faster than the Stop button
  can be pressed. Stop terminates the worker, so it recovers, but the tab may be
  unresponsive for a moment first.
- Cross-origin isolation is a progressive enhancement. Where it is unavailable —
  notably Safari inside a third-party embed — `input()` reads from a
  pre-supplied box instead of prompting. This is a documented reduction in
  fidelity, not a security boundary.

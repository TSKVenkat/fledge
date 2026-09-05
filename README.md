<h1>fledge</h1>

**A coding classroom that runs in the browser and on your own server.**

Students write Python, press Run, and it executes in their own browser tab. No
code is ever sent to a server to be run — which is why a whole school can work
from one small box, and why nothing here costs per-student compute.

Trinket shut down in August 2026 and its open-source release went unhosted
because the server costs were too high: Python 2 ran client-side and was free,
Python 3 needed real CPython on a server and was not. That asymmetry no longer
exists. Pyodide ships CPython 3.14 compiled to WebAssembly, so Python 3 runs in
the tab for nothing.

---

## Status

**Early. The execution runtime works; the platform around it does not exist yet.**

Working today, and covered by tests that run in a real browser:

- Real Python 3.14 in the browser, with blocking `input()` and a Stop button
  that stops a `while True:`
- turtle graphics, drawn from a retained display list
- Tracebacks that point at the student's own line with no runtime frames
- The editor, and the cross-origin sandbox it drives

Described below but **not yet implemented**: accounts, classes, assignments,
share links, embeds, the HTML/CSS/JS preview, matplotlib, and the Docker
deployment. Those are the plan, not the present.

If you are looking for something to run in a classroom next term, this is not
it yet. If you are interested in the execution model, that part is real and
you can drive it locally with `pnpm --filter @fledge/web dev`.

---

## What it will do

- **Real Python 3.14**, not a reimplementation. `input()` blocks the way it does
  in a terminal, and Stop always stops.
- **turtle** graphics and **matplotlib** figures.
- **HTML, CSS and JavaScript** with a live preview.
- **Share a link**, or **embed a runnable snippet** in any page — a blog, a
  worksheet, a virtual learning environment. The embed needs nothing from the
  page hosting it.
- **Classes and assignments**: a join code, per-student copies of a starter
  project, and one screen where a teacher opens and runs any submission.
- **No student email required.** A teacher creates accounts and hands out a
  printed sheet.

## What it deliberately does not do

- **It never executes code on the server.** Not in any language, not at any
  version. This is the reason the project can exist, so it is a stated non-goal
  rather than a missing feature.
- No AI features.
- No autograding, no plagiarism detection.

## Running it today

There is no Docker image yet. From source:

```bash
git clone https://github.com/TSKVenkat/fledge.git
cd fledge
pnpm install
pnpm --filter @fledge/web dev
```

Open <http://localhost:5173>. The sandbox is served from `127.0.0.1` on the same
port — a different origin deliberately, so the security boundary exists in
development too.

To check it end to end:

```bash
pnpm test                             # unit
node packages/runtime/test/run.mjs    # the runtime, in a real browser
node e2e/smoke.mjs                    # the editor, driven as a student
```

## Documentation

| | |
|---|---|
| [Installation](docs/guide/installation.md) | Docker, from source, upgrading, production |
| [Configuration](docs/guide/configuration.md) | Every environment variable |
| [Embedding](docs/guide/embedding.md) | Putting a runnable snippet in your own page |
| [Architecture](docs/reference/architecture.md) | How the sandbox works, and why |
| [turtle support](docs/reference/turtle.md) | Exactly which names are implemented |
| [Security](SECURITY.md) | The sandbox threat model, and reporting a problem |

## Licence

[AGPL-3.0-only](LICENSE). If you run a modified copy as a network service, the
licence asks you to offer that modified source to its users. Third-party
components and their licences are listed in [NOTICE](NOTICE).

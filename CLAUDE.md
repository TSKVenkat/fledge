# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm lint                 # eslint
pnpm typecheck            # tsc across every workspace, plus the service worker's own tsconfig
pnpm test                 # vitest: unit, and the API against an in-process Postgres
pnpm build                # production build of the web app (nothing else has a build step)
pnpm docs:dev             # VitePress, docs/

pnpm vitest run path/to/file.test.ts          # one file
pnpm vitest run -t 'part of the test name'    # one test
```

The whole instance, application on <http://localhost:8080> and sandbox on <http://localhost:8081>:

```bash
cp .env.example .env      # then set SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

From source, with no containers at all:

```bash
pnpm --filter @fledge/web dev     # :5173; the sandbox is 127.0.0.1:5173, a different origin on purpose
```

`pnpm db:generate` after changing `packages/db/src/schema.ts`; the compose stack runs
migrations itself before the API starts.

### The browser suites

Unit tests are cheap and pure. Anything about the *runtime* needs a real browser,
because the behaviour under test — whether `input()` blocks, whether a worker still
receives a message while Python is suspended — cannot be faithfully faked.

```bash
node packages/runtime/test/run.mjs     # the runtime, bundled into a fixture
node e2e/smoke.mjs                     # the editor, against the vite dev server
```

The suites that found nearly every real bug run against the **built Docker stack**,
because two origins and real headers are what a school runs and the dev server does
not reproduce them. Start the stack, then:

```bash
node e2e/deployment.mjs   # the stack itself
node e2e/embed.mjs        # an embed on a third-party origin
node e2e/webpreview.mjs   # HTML/CSS/JS at an opaque origin
node e2e/share.mjs        # share links, passwords, remix, revoke
node e2e/classroom.mjs    # a whole lesson, teacher and student, including the forced password change
node e2e/admin.mjs        # creating and disabling teachers
node e2e/multifile.mjs    # projects with several files
node e2e/offline.mjs      # the runtime boots from cache with the network gone
node e2e/webkit.mjs       # a real WebKit engine, then the batch tier forced with ?tier=batch
node e2e/boot-throttled.mjs   # time-to-Run at 4x CPU and Fast 3G; prints numbers, does not assert
```

CI runs all of them. **After changing the stack, `docker compose up -d --build`
rebuilds the image but may leave the old container running.** Use
`up -d --force-recreate web` (or `api`) and confirm the served bundle hash changed;
a whole debugging cycle was once spent on a "stale build" that was a stale container.

### One heavy thing at a time

Every database test file starts its own in-process Postgres, and each browser suite
boots Pyodide. `vitest.config.ts` sizes its worker pool from `MemAvailable` because a
pool sized to the CPU count produced timeouts that looked like flakiness and were
memory pressure. Do not run several browser suites concurrently.

## Architecture

Students write Python (or HTML/CSS/JS), press Run, and it executes in their own
browser tab. **Nothing executes on the server, in any language, at any version.**
That is the economics, not a security posture: the product exists because a whole
school then fits on one small box. Single-tenant: one instance is one school.

```
Application  app origin        editor, console text, accounts, classes
  └── iframe → Sandbox  a DIFFERENT HOST NAME   owns every drawing surface
        └── Web Worker                          Pyodide / CPython 3.14 — student code runs here
```

**`packages/runtime`** is the sandbox core and has no React. Student Python runs in a
Worker, which has no DOM: `js.document` does not resolve, and drawing arrives only as a
retained list of operations the frame paints. Capabilities are **measured, never
declared** (`capabilities.ts` constructs a `SharedArrayBuffer` rather than trusting
`crossOriginIsolated`) and three tiers fall out: *isolated* (SAB, graceful interrupt),
*suspending* (JSPI — blocking `input()` with no isolation at all, which is what makes a
third-party embed work), and *batch* (a pre-filled Input box). Stop is
`worker.terminate()`, which needs none of that and works everywhere. `?tier=batch` on a
frame or embed URL forces the degraded tier; it is how that tier is tested, since every
engine to hand offers JSPI or SAB.

Errors are formatted **inside Python** (`_fledge_run` in `worker/index.ts`), filtering
structured frames so the first line a student reads is their own. A regex over the
JavaScript exception leaked Pyodide's frames into a child's console; that is the bug
this replaced.

**`packages/db`** is Drizzle over Postgres, one schema file, invariants as constraints:
a user has an email or a username (check), class membership is a composite key, one
submission per student per assignment (unique). `testing.ts` gives tests a PGlite with
the real migrations applied.

**`apps/api`** is Fastify. Sessions are rows, not signed tokens, so revocation is a
delete. `requireOwnerOrAdmin` and the class guards return **404, not 403**, so an
endpoint never confirms an id exists to somebody unconnected. Revoked, expired, deleted
and never-existing share links are byte-identical from outside. Anonymous projects
reuse the share-link construction — random bytes, looked up by hash, sealed under
`SECRET_KEY` so the token can be shown again — and that is what lets someone write a
program with no account and come back tomorrow.

**`apps/web`** is React + Vite with two extra entries: `frame.html` (the sandbox
document) and `embed.html` (a runnable example for someone else's page). `src/sw.ts` is
a service worker on the sandbox origin that precaches the runtime core at install; it
has its own `tsconfig.sw.json` because its globals are not the page's.

## Things that will bite

**The sandbox must be a separate host name, not a port.** Cookies ignore ports, so a
second port shares the application's cookies and provides no isolation whatsoever.
Locally the compose stack uses a port because it is one machine; `SECURITY.md` and the
installation guide both say why a network deployment cannot.

**CodeMirror owns its document and mounts once.** Changing the `value` prop does
nothing. Every "the editor shows the wrong file" bug in this project — after switching
language, after a project loaded, after switching tabs — was this. The editor is keyed
on `${activeFile}-${documentKey}`; treat a new document as a remount, not an update.

**`useRunner` needs its mount element on the first render.** Its effect depends on
the ref object, which never changes, so if the element is absent when the effect first
runs the sandbox is never created and nothing retries. An early `return <Loading/>`
above the mount point breaks it silently.

**The input prompt must not be printed from Python.** Pyodide batches stdout by line;
a prompt written with `end=""` sits in the buffer and appears *after* the answer. It
travels in the `inputRequest` message and the host echoes prompt and answer together.

**The embed's iframe is sandboxed without `allow-forms`.** A `<form>` there is blocked
before any handler runs. The input box is a keydown handler for that reason; widening
the sandbox to suit the interface would be the wrong way round.

**The web preview runs at an opaque origin, so it cannot load our blob: URLs** — blob
URLs are bound to the origin that made them. Relative stylesheets and scripts are
inlined into the document instead (`web/preview.ts`).

**Pyodide 314 rejects classic workers** (`importScripts` fails) and **its npm package
ships no wheels**. The core is self-hosted; packages come from `packageBaseUrl`, a CDN
by default, or vendored with `apps/web/scripts/vendor-packages.mjs` for a school with
no internet.

**Node runs `.ts` directly by stripping types, and cannot strip a parameter
property.** There is an eslint rule for it; do not disable it.

**A failing command in an `&&` chain does not stop a script under `set -e`.** A
syntax error was once pushed because `node --check` failed inside one. Put checks on
their own line.

## Conventions

Comments explain *why*, not what. A note saying why a fixed value is correct where the
obvious one is wrong earns its lines; `// increment i` does not.

Commit messages carry the reasoning: what was wrong, why the obvious fix was not the
one taken. **No AI or co-author trailers** in commits or pull requests.

A bug fix comes with a test that fails without it, ideally with the same message
production gave. Several tests here name the bug they were written against.

A test must assert what must be true, not the one symptom noticed. An early traceback
test grepped for two frame names and passed while other frames still leaked.

Named exports only; relative imports carry their `.ts`/`.tsx` extension; British
English in prose.

## Dependabot

Dependabot opens pull requests weekly for npm and monthly for GitHub Actions
(`.github/dependabot.yml`). **Pyodide is excluded.** A runtime bump changes which
Python students get and which packages exist; it is reviewed deliberately, never swept
in with a batch of patch updates.

A Dependabot branch was cut from an older `main`, so its CI may fail for a reason that
is already fixed. Comment `@dependabot rebase` on the pull request rather than
debugging the old code, then merge once the stack job is green. Dev-tooling bumps are
grouped so they arrive as one pull request.

## Scope

**No server-side execution, no AI features, no requiring a child to have an email
address, no multi-school tenancy, no analytics on students.** These are settled; see
`ROADMAP.md`, which also lists what is deferred and why.

# Contributing

Thank you for considering it. This document says how the project works so that a
first patch is not a guessing game.

## Before a large change

Open an issue first. A change that alters the execution model, adds a
dependency that ships to the browser, or widens what a student's code can reach
is worth agreeing before it is written, not after.

Small fixes need no ceremony. Send them.

## What the project will not accept

These are settled, and a pull request implementing one will be declined however
good the code is:

- **Server-side execution of student code**, in any language. The entire
  economic argument for the project is that this does not happen.
- **AI features.**
- Anything that requires a student to have an email address.
- A dependency that ships to the browser and is not doing work the platform
  cannot already do.

## Running it

```bash
pnpm install
pnpm --filter @fledge/web dev     # http://localhost:5173
```

The application is served from `localhost` and the sandbox frame from
`127.0.0.1`. That is the same server on a different origin, deliberately: the
security boundary is between those two origins, and running them apart in
development means a mistake shows up locally rather than in production.

## Tests

```bash
pnpm test                                    # unit and API, on an in-process Postgres
node packages/runtime/test/run.mjs           # the runtime, in a real browser
node e2e/smoke.mjs                           # the editor, against the dev server
```

The suites that matter most run against the built Docker stack, because two
origins and real headers are the arrangement a school runs and the dev server
does not reproduce it. Start the stack (see README), then:

```bash
node e2e/deployment.mjs     # the stack itself
node e2e/embed.mjs          # an embed on a third-party origin
node e2e/webpreview.mjs     # HTML/CSS/JS at an opaque origin
node e2e/share.mjs          # share links, passwords, remix, revoke
node e2e/classroom.mjs      # a whole lesson, teacher and student
node e2e/admin.mjs          # creating and disabling teachers
node e2e/multifile.mjs      # projects with several files, Python and web
node e2e/offline.mjs        # the runtime boots from cache with the network gone
node e2e/webkit.mjs         # a real WebKit engine, plus the batch tier forced
node e2e/boot-throttled.mjs # cold-boot timing under CPU and network throttling
```

CI runs all of them. A change to the runtime, the frame, or the deploy headers
is not verified until these pass.

The unit tests are pure and fast. Anything about the *runtime* needs a real
browser, because the behaviour under test — whether `input()` blocks, whether a
worker can still receive a message while Python is suspended — cannot be
faithfully faked.

**A bug fix comes with a test that fails without it.** Ideally write the test
first and watch it fail with the same message the bug produced. Several tests
here name the bug they were written against; that is the standard.

A cautionary tale worth repeating: an early version of the traceback test
grepped for two frame names and passed while Pyodide's own frames were still
leaking into student errors. Assert on what must be true, not on the one symptom
you happened to notice.

## Style

- Comments explain **why**, not what. A note explaining why a fixed path is
  correct where a temporary one is wrong earns its lines; `// increment i` does
  not.
- Named exports only. No default exports outside config files.
- Relative imports carry their `.ts` / `.tsx` extension.
- British English in prose and comments.

## Commits and pull requests

- Subject in the imperative, body wrapped at 80 columns.
- The body carries the reasoning: what was wrong, and why the obvious fix was
  not the one taken.
- **No AI or co-author trailers**, in commits or in pull request descriptions.
- One subject per pull request. Say what you verified and how.
- CI must be green before review.

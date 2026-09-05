# Roadmap

What is planned, what is deliberately not, and why. Deferred is not the same
as declined; the second list is settled.

## Next

- **Older Safari.** The design assumed Safari had no JSPI. Running the suite in
  a real WebKit engine (26.5, via Playwright) showed it does: a WebKit embed on a
  third-party page prompts live, exactly as Chrome does. The batch tier is now
  exercised only by forcing it (`?tier=batch`), because no engine to hand lacks
  both JSPI and SharedArrayBuffer. Which Safari versions *do* lack JSPI, and how
  many students are on them, is unmeasured -- and is what would make the batch
  tier matter.
- **Cold boot on real school hardware.** Measured so far only on a desktop made
  slower (`e2e/boot-throttled.mjs`, Chrome DevTools throttling):

  | | to Run, cold | to Run, warm |
  |---|---|---|
  | desktop, no throttling | 2.4 s | 2.3 s |
  | CPU 4x slower | 2.6 s | 2.4 s |
  | CPU 4x slower + Fast 3G | 7.9 s | 3.9 s |

  Inside the 15 s budget, and warm-equals-cold on a fast machine shows the
  2.3 s is Pyodide initialising, not downloading. But a throttled desktop is not
  a Chromebook on school wifi; that measurement still needs the machine.
- **A real classroom.** No teacher has used this. Everything above is
  engineering judgement about what a teacher wants; the first afternoon with one
  will correct some of it.

## Deferred

Real work that is not in scope until the above is done and a school is using
the result.

- Games. Pyodide's SDL support requires a real `HTMLCanvasElement`, which does
  not exist in a Worker, and on the main thread there is no Stop button at all —
  a student's `while True:` would freeze the tab, and in an embed, the page
  hosting it. A canvas game module of our own is the likely shape.
- Autograding and test runners. The single biggest temptation and the single
  biggest sink. The submission grid exists so a teacher can read the code.
- LTI, Google Classroom, OIDC/SSO. Each is larger than everything shipped so
  far, and benefits nobody until a school is already using this.
- Real-time collaborative editing. Teachers ask to *see* a student's screen;
  refreshing the grid is the cheap version of that.
- Version history.
- Installing packages from PyPI at run time. Behind `ALLOW_MICROPIP`, default
  off: many school networks block PyPI, and a half-working install is worse than
  a clear "not available here".

## Not planned

Settled. A pull request implementing one of these will be declined regardless
of the quality of the code.

- **Server-side execution of student code**, in any language, at any version.
  The entire economic argument for the project is that this does not happen.
  It is the reason a whole school fits on one small box.
- **AI features.**
- **Requiring a student to have an email address.** A child should not need a
  mailbox to learn to program, and a school should not have to hold a parent's
  address to run a lesson.
- **Multi-school tenancy.** One instance is one school. Two schools are two
  compose files. Every feature would otherwise have to be expressed through an
  organisation lattice, and the data model stays honest without one.
- **Analytics on students.** No view counts, no time-on-task, no dashboards
  about children.

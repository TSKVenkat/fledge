# Roadmap

What is planned, what is deliberately not, and why. Deferred is not the same
as declined; the second list is settled.

## Next

- **Safari.** The batch tier — a pre-filled Input box and turtle drawings
  replayed after the program finishes — is designed, typed and unit-tested, and
  has never run in WebKit. Until it has, every claim about Safari embeds is an
  inference. This is the largest untested assumption in the project.
- **Cold boot on school hardware.** The one number we have (2.2 s) is from a
  fast desktop with warm local assets. A Chromebook on school wifi is the real
  target, and the loading design should be judged against it.
- **A real classroom.** No teacher has used this. Everything above is
  engineering judgement about what a teacher wants; the first afternoon with one
  will correct some of it.
- Project rename and delete from the interface.
- The `must_change_password` flow. The flag is set on bulk-created accounts and
  honoured nowhere.
- Admin screens for creating teachers. Today the first administrator is created
  from the environment and further teachers only through the API.
- A service worker on the sandbox origin, so the runtime is cached across visits
  rather than only by the browser's ordinary cache.
- Multi-file projects in the editor. The API stores them; the editor shows one.

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

# Changelog

All notable changes. The project does not yet have a release; this records what
exists on `main`.

## Unreleased

### Added
- Real Python 3.14 in the browser via Pyodide, with blocking `input()` in every
  tier the browser allows, and a Stop button that stops a `while True:`.
- turtle graphics from a retained display list; matplotlib figures rendered to
  PNG; an HTML/CSS/JS preview at an opaque origin.
- Accounts with sign-in by email or username; the first administrator created
  from the environment.
- Projects, including anonymous projects that reopen from an edit token kept in
  the browser.
- Share links, optionally password-protected, with remixing into a fresh copy.
- Embeds: one script tag drops a runnable example into any page, with no
  co-operation from that page.
- Classes with a join code; a register that creates a whole class's accounts
  with printable passwords; assignments with a private copy per student and a
  grid that lists everyone including those who have not started.
- `docker compose up`, with the application and the sandbox on separate origins.
- Administration: creating teachers, resetting passwords, disabling accounts.
  There is no self-registration; a school decides who teaches in it.
- An account given a password by someone else -- a bulk-created student, a new
  teacher -- must choose its own before reaching anything else.
- Renaming a project in place, and deleting one.
- Projects with more than one file: tabs in the editor, a helper module that
  `main.py` can import, and a web project whose HTML pulls in its own CSS and
  JavaScript by relative reference. The same path rule is enforced in the
  editor and the API, so a name the editor accepts is never one the API
  refuses.
- A service worker on the sandbox origin caches the runtime core and any package
  wheels after first use, so a machine boots Python again with no network.
- `e2e/boot-throttled.mjs`: cold-boot timing at 4x CPU throttling and Fast 3G
  (7.9 s to Run; 3.9 s warm).

### Changed
- `?tier=batch` on a frame or embed URL forces the degraded tier, for testing
  and for seeing what an older browser gets. Running the suite in a real WebKit
  engine showed WebKit 26.5 has JSPI, so a Safari embed prompts live; the
  documentation said otherwise and now does not.

### Fixed
- Relative stylesheets and scripts in a web project did not load. They were
  turned into blob: URLs, which are bound to the origin that made them, and the
  preview runs at an opaque origin precisely so it cannot reach ours. They are
  inlined into the document instead.

### Security
- The sandbox is a separate origin and must be a separate host name, not a port.
- Revoked, expired, deleted and never-existing share links are byte-identical
  from outside.
- Tracebacks contain only the student's own frames.

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

### Security
- The sandbox is a separate origin and must be a separate host name, not a port.
- Revoked, expired, deleted and never-existing share links are byte-identical
  from outside.
- Tracebacks contain only the student's own frames.

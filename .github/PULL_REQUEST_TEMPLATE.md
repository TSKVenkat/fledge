## What this changes

<!-- One paragraph. What was wrong, and why this fix rather than the obvious one. -->

## How it was verified

<!-- Commands run, and what you saw. "CI is green" on its own is not enough for
     anything touching the runtime, because the interesting behaviour only shows
     up in a real browser. -->

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] Runtime touched? `node packages/runtime/test/run.mjs` passes
- [ ] Behaviour changed? A test fails without this patch

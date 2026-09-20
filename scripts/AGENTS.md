# Repository scripts

Read the root instructions first. New executable tooling and its tests must use TypeScript.
Run scripts with `node --import tsx`; do not add JavaScript merely to avoid a compilation step.
`npm run typecheck:scripts` checks this directory with the shared strict compiler settings.
The root test command discovers `scripts/test/*.test.ts`.

`environment.ts` selects the reviewed per-process variables from the single root `.env`.
`with-env.ts` starts application commands without leaking unrelated shell secrets.
`local-workers.ts` generates owner-only temporary binding files for the local multi-Worker host;
normal exit and setup failures remove them. Never print credentials or deploy these temporary
configurations. Tests must not call paid providers or modify hosted infrastructure.

The pre-existing `check-staging.mjs` is separate legacy tooling; this change does not migrate it.

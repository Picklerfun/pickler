# Mobile app instructions

Read [the root instructions](../../AGENTS.md) first.

`@pickler/mobile` is the marketplace on iOS: an Expo app (React Native) where a person holds a Mera
passkey wallet, trades perpetuals on Perpl and asks agents for reads. It arrived from
`Picklerfun/pickler-expo` on 2026-10-01 with its history
([the specification](../../docs/specs/mobile-monorepo-v1.md)). How to run, verify and ship it is in
[README.md](README.md), which is in Spanish like the rest of the imported record.

## Expo has changed

Read the exact versioned documentation at https://docs.expo.dev/versions/v57.0.0/ before writing any
code. Do not rely on what earlier SDKs did.

## Rules

- **No TestFlight archive or upload, and no change to `ios.buildNumber`, without explicit
  authorisation.** An authorisation already given stays in force; do not ask again.
- One worktree per task, and commit by path (`git commit -- <paths>`), never `git add -A`: other
  agents work in this repository at the same time.
- **The bounty deadline is 2026-10-13, 21:59 CST.** Every decision of scope for the app is measured
  against it. Until then `Picklerfun/pickler-expo` stays as the frozen reference the submission
  names; new work lands here.
- The account is derived by [`@pickler/mera-account`](../../packages/mera-account/AGENTS.md) and by
  nothing else. Its relying party is `pickler.fun` (`app.config.ts`, `rpId`). Neither changes: both
  move every person's address.
- What Perpl publishes is parsed by [`@pickler/perpl-context`](../../packages/perpl-context/AGENTS.md),
  shared with the web's market board. `src/perpl/context.ts` only adds the network call.
- The app's own documentation — specs, plans, overviews, audits and the catalogue — lives in
  [`docs/mobile/`](../../docs/mobile/AGENTS.md) and follows that directory's contract. Read it
  before writing there. The product's state is in `docs/mobile/04-roadmap-bounty.md` and the
  catalogue `docs/mobile/overview/index.html`.
- Three skills in `.agents/skills/` (linked from `.claude/skills/`) carry the app's routines:
  `pickler-retomar` to pick up context, `pickler-overview-new` for a new sub-project and
  `pickler-dev-new` for a fix, a feature or a build.
- The backend of Ask is [`services/reads/`](../../services/reads/AGENTS.md).

## Install, check

The app is a workspace under the root lockfile: install from the repository root with `npm ci`,
never inside this directory. Its dependencies are nested under `apps/mobile/node_modules` at the
versions the app shipped with; adding or bumping one goes through `npm install` at the root, and
`react` moves only together with the root `overrides`.

```sh
npm run typecheck --workspace=@pickler/mobile
npm test --workspace=@pickler/mobile   # Jest, 44 suites
```

`dependency-tree.txt` records every dependency the app resolves from the shared lockfile, one line per edge (`who@version -> what@version`), and
`npm run app:tree --prefix scripts/mobile` (run in CI) fails when that changes. It exists because
the web shares the lockfile: a dependency the web adds can be hoisted to the root and replace the
copy the app was built with, as `@category-labs/mera` once was, taking the app's `viem` with it. A
failure is fixed by restoring the app's own entries under `apps/mobile/node_modules` in
`package-lock.json`, or accepted on purpose with `npm run app:tree:write --prefix scripts/mobile`
and said in the pull request.

Neither ESLint nor Prettier from the root applies here yet; keep the style the files already have.
`CLAUDE.md` beside this file is the one-line adapter `@AGENTS.md`.

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
- **The account is the web's, and its username is not optional**
  ([spec](../../docs/mobile/superpowers/specs/2026-10-02-mobile-account-design.md)). With the wallet
  unlocked, `useIdentity` signs in to the product API (`workers/api`, through the web host) with the
  server's own message and `kind: "mera"`, at no extra prompt, and reads the profile. Because there
  is no prompt, the wallet signs nothing it has not checked: `checkSignInMessage`
  (`src/identity/session.ts`) refuses anything that is not a well-formed SIWE for this address, the
  app's chain, the exact statement `Sign in to Pickler` and the passkey's domain (`RP_ID`) or a
  subdomain of it. The same API route also issues the message that lets another wallet into an
  account (`Link wallet 0x… to this wallet's Pickler account`); the app never asks for it and
  never signs it. An account the
  server says has no username gets `UsernameGate` (`src/screens/username.tsx`) over the whole app,
  outside the navigation tree: the only ways out are claiming one or signing out. Only that answer
  holds anybody, and only while there is a way out: an API that is not configured, unreachable or
  failing holds nobody (`src/identity/state.ts`), and if claiming or checking again fails for a
  reason that is not the username itself the gate lets go for the session. The app moves funds; do
  not add a path where the account keeps somebody out of them. Before saying a claim failed the
  hook signs in again and reads the account, because the answer may only have been lost. The gate
  does not open over a treasury operation, a read in flight or Perpl's onboarding while it runs
  (`appQuiet` and `perplOnboardingActive` in `src/identity/state.ts`, read by `App.tsx`): each of
  those unlocks the wallet, and unlocking is what triggers the check. An onboarding stopped on an
  error runs nothing and does not count. The identity client's deadline (`src/identity/api.ts`) covers the body
  as well as the headers. The access token stays in
  memory and is never stored; what is stored is `{ address, handle, api }` (`pickler.identity.v1`). Linking to an account under a browser wallet happens
  on the web, where that wallet can sign; the gate says so and checks again. The feature is **off
  unless `PICKLER_API_URL` is set** (`src/config/api.ts`), e.g. `https://pickler.fun/api/v1`, and
  the API needs `SIWE_DOMAIN` and `WALLET_EMAIL_DOMAIN` for the routes to exist. The handle rules in
  `src/identity/handle.ts` are a copy of `@pickler/api-schema`'s, pinned by
  `__tests__/identity-handle.test.ts`; importing the package would move the app's dependency tree.

## Install, check

The app is a workspace under the root lockfile: install from the repository root with `npm ci`,
never inside this directory. Its dependencies are nested under `apps/mobile/node_modules` at the
versions the app shipped with; adding or bumping one goes through `npm install` at the root, and
`react` moves only together with the root `overrides`.

```sh
npm run typecheck --workspace=@pickler/mobile
npm test --workspace=@pickler/mobile   # Jest, 51 suites
```

`dependency-tree.txt` records every dependency the app resolves from the shared lockfile, one line per edge (`who@version -> what@version`), and
`npm run app:tree --prefix scripts/mobile` (run in CI) fails when that changes. It exists because
the web shares the lockfile: a dependency the web adds can be hoisted to the root and replace the
copy the app was built with, as `@category-labs/mera` once was, taking the app's `viem` with it. A
failure is fixed by restoring the app's own entries under `apps/mobile/node_modules` in
`package-lock.json`, or accepted on purpose with `npm run app:tree:write --prefix scripts/mobile`
and said in the pull request.

Neither ESLint nor Prettier from the root applies here yet; keep the style the files already have.
That includes the rules of hooks, and no suite mounts `App` or a screen, so a hook called after an
early `return` passes the typecheck and Jest and crashes the app on its second render. It happened
once, in `App.tsx`. `__tests__/app-hooks.test.ts` reads every component and fails on it; keep hooks
above any early return, and launch the app in a simulator before saying a change to `App.tsx` works.
`CLAUDE.md` beside this file is the one-line adapter `@AGENTS.md`.

# Mobile monorepo v1: the marketplace app moves in, and one wallet rule for both surfaces

Status: approved by the owner on 2026-10-01 (design reviewed in conversation). Branch
`codex/mobile-monorepo`.

## 1. Problem

The marketplace has two clients: the web (`apps/web`, this repository) and the iOS app
(`Picklerfun/pickler-expo`). They were built apart, and a review on 2026-10-01 found that they do
not line up:

1. The app derives its account as PRF output → BIP-39 mnemonic → `m/44'/60'/0'/0/0`. The web's
   retired Mera signer, and the draft `marketplace-wallets-v1.md` (PR #65, D2), use the PRF output
   itself as the private key. The same passkey would give two addresses.
2. The app enrols its passkey against `pickler.fun`. `product-hosts-v1.md` moves Mera to
   `app.pickler.fun` and Turnkey to `studio.pickler.fun`. Nothing in the code does either, and the
   app's build 11 is already with external testers on `pickler.fun`.
3. Level tables, leverage options, venue limits and read rules exist twice and disagree.
4. The specs in PR #65 were written without the app's source, which was in a repository their
   author could not see.

Two repositories are why none of this was caught. This specification moves the app into this
repository and fixes the two decisions that cannot be changed later: the relying parties and the
derivation rule. Shared rules, sign-in and one backend are later specifications that this one makes
possible.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                | Reversible?                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| W1  | **Mera's relying party is `pickler.fun`**, on the web and in the app. The app already ships with it.                                                                                                    | no, once anyone holds funds                    |
| W2  | **Turnkey's relying party is `app.pickler.fun`**, and only the studio uses it. No Turnkey passkey has been enrolled outside `localhost`, so the value is still free to set.                             | no, after the first enrolment                  |
| W3  | **One derivation rule:** 32 bytes of PRF output → 24-word BIP-39 mnemonic (English list) → BIP-39 seed with an empty passphrase → BIP-32 path `m/44'/60'/0'/0/<index>`, index 0 for the account.        | no, once anyone holds funds                    |
| W4  | Mera's PRF model with its default salt. The vault model is not used on any surface.                                                                                                                     | no, same reason                                |
| W5  | The app's source lives in this repository with its history. `pickler-expo` is frozen, not archived, until the bounty of 2026-10-13 closes, because it is the repository the submission names.           | yes                                            |
| W6  | `apps/mobile` is an npm workspace, `@pickler/mobile`, under the root lockfile. One React for the whole repository, pinned by a root `overrides` to the version the app's React Native release requires. | yes (§8 names the fallback)                    |
| W7  | The rule of W3 is one package, `@pickler/mera-account`, with frozen test vectors. The app imports it; the web's future Mera signer must.                                                                | the package: yes. The vectors: never rewritten |
| W8  | Custody is not composed, and `/v1/signing` stays unmounted, when `TURNKEY_RPID` equals Mera's relying party or is `localhost` outside local development. The API logs why and serves everything else.   | yes                                            |

W1 and W2 are the owner's, stated on 2026-10-01, and they replace the three-host plan of
`product-hosts-v1.md` §3–§4 and of `product-hosts-cutover-v2.md` (PR #65). They match what
`apps/web/src/server/hosts.ts` already falls back to: the marketplace on `pickler.fun`, the studio on
`app.pickler.fun`.

**What W1 costs, stated once.** A passkey's scope reaches downward: a page on any subdomain of
`pickler.fun` may ask for an assertion with `rpId: "pickler.fun"`, and with PRF that assertion is
the Mera seed. The studio host is such a subdomain. Every host under `pickler.fun` is therefore
inside the marketplace wallet's trust boundary, and none may be delegated to a third party. The
reverse does not hold: a Turnkey passkey on `app.pickler.fun` is never offered to a page that asks
for `pickler.fun`.

## 3. Where everything lands

| In `pickler-expo`                    | In this repository                                                |
| ------------------------------------ | ----------------------------------------------------------------- |
| `apps/mobile/`                       | `apps/mobile/` (workspace `@pickler/mobile`)                      |
| `services/reads/`                    | `services/reads/` (not a workspace; its own lockfile, as now)     |
| `infra/`                             | `infra/`                                                          |
| `docs/`                              | `docs/mobile/`                                                    |
| `scripts/`                           | `scripts/mobile/` (not a workspace; its own lockfile)             |
| root `package.json`, lockfile        | `scripts/mobile/package.json`, `scripts/mobile/package-lock.json` |
| `.agents/skills/`, `.claude/skills/` | the same paths                                                    |
| root `README.md`                     | `docs/mobile/README.md`                                           |
| root `CLAUDE.md`, `AGENTS.md`        | folded into `apps/mobile/AGENTS.md`                               |
| root `.gitignore`                    | folded into the root `.gitignore`, scoped to the app's paths      |

The documentation tree moves as one block. No link inside it reaches outside `docs/`, so every
relative link survives; only the tooling, the three skills and the instruction files name paths
from the repository root, and those are rewritten.

## 4. How it moves

1. In a throwaway clone of `pickler-expo`, one commit rearranges the paths of §3 with `git mv`.
2. In this worktree, `git merge --allow-unrelated-histories` brings that commit and its 335
   ancestors in. No path collides, so the merge has no conflicts. `git log --follow` and `git blame`
   keep working across the move.
3. Everything after the merge is ordinary commits on `codex/mobile-monorepo`, delivered as one pull
   request. Nothing is pushed to `main`.

## 5. Integration

**Workspaces.** `apps/*` already matches `apps/mobile`. Its package is renamed `@pickler/mobile`,
its own lockfile is deleted, and the root lockfile is regenerated with npm 10.9.3. A root
`overrides` pins `react` and `react-dom` to the app's version; the web moves down to it and both
move up together when Expo does. `viem` in the app moves to 2.56.8, the version the rest of the
repository resolves.

**The lockfile must not move the app.** Before and after the merge, the resolved version of every
package under the app's dependency tree is listed and compared. Any difference other than `react`
(unchanged for the app), `viem` and its own dependencies is a failure to explain, not to accept.

**Metro.** Expo 57 configures Metro for a monorepo by itself. No `metro.config.js` is added unless
the simulator run of §7 shows it is needed.

**Lint and format.** `apps/mobile`, `services/reads`, `infra`, `docs/mobile`, `scripts/mobile`,
`.agents` and `.claude` join the ignore lists of ESLint and Prettier. Adopting the repository's
style in the app is separate work: it would reformat every file in the same change that moves them.

**Typecheck.** The app gains a `typecheck` script, so `npm run typecheck` covers it.

**CI.** A new workflow, `mobile.yml`, runs the app's typecheck and Jest suite, the vectors, the
agent and docs tooling checks, and the reads service's Node and Deno tests.

**Instructions.** `AGENTS.md` is the real file everywhere in this repository. Where the imported
tree had `CLAUDE.md` as the real file and `AGENTS.md` as a link to it, the two swap: `AGENTS.md`
holds the text and `CLAUDE.md` is a one-line `@AGENTS.md`. The root project map gains
`apps/mobile`, `packages/mera-account`, `services/reads`, `infra` and `scripts/mobile`, each with a
local `AGENTS.md`.

**Language.** The root rule says documentation is written in English. `docs/mobile/`, the three
`pickler-*` skills and the app's own README are an imported record in Spanish and stay as they
are; the root `AGENTS.md` names the exception. New instruction files are in English.

**The docs tooling.** `scripts/mobile/` keeps `agents:check`, `agents:test`, `agents:inventory`,
`docs:html` and `docs:check`, repointed at `docs/mobile/`. `agents:check` validates only the
imported tree's instruction files; it does not impose the 24 KiB chain limit on the rest of the
repository. The generated HTML beside each spec and plan embeds the generator's path, so all of it
is regenerated once.

## 6. `@pickler/mera-account`

`packages/mera-account/src/index.ts`, shaped like `@pickler/chain`: TypeScript source as the
export, no build step. It is the app's `src/hd/hd.ts`, moved:

```ts
export function prfOutputToMnemonic(prfOutput: Uint8Array): string;
export function mnemonicToSeed(mnemonic: string): Uint8Array;
export function deriveEvmPrivateKey(seed: Uint8Array, index: number): Uint8Array;
```

It depends on `@scure/bip32` and `@scure/bip39` at the versions the app pins today and on nothing
else: no React, no React Native, no Mera SDK, no viem at run time.

`packages/mera-account/test/vectors.json` holds PRF outputs with the mnemonic, the private key and
the address each one gives. The vectors are produced by the app's code **before** the move, in the
untouched `pickler-expo` checkout, and are never regenerated: a change that makes them fail is a
change that moves everyone's funds. The package's test and a test in the app both read the same
file.

## 7. The Turnkey guard and the documents

`packages/core` gains `MERA_RELYING_PARTY` and a pure rule, `turnkeyRelyingPartyProblem(rpId, appEnv)`.
`workers/api/src/container.ts` asks it before composing custody: with the relying party equal to
`pickler.fun`, or `localhost` when `APP_ENV` is neither `local` nor `development`, custody is not
composed, the reason is logged, and the rest of the API serves — the pattern an unsupported
`CHAIN_ID` already follows. A missing `TURNKEY_RPID` keeps today's behaviour: custody is off.
Failing the whole API was considered and refused: a mistaken value would take down the marketplace
to protect a studio feature that is already off.

Documents corrected in the same change, each with a dated pointer to this specification rather
than a rewrite: `product-hosts-v1.md` (§3 and §4 superseded), `turnkey-passkey-custody-v1.md`
(production value), `user-profiles-and-products-v1.md` (the two superseded notes),
`workers/api/.dev.vars.example`, `workers/api/AGENTS.md`, and the paragraph of `apps/web/AGENTS.md`
that explains why the PRF signer was retired. A comment on PR #65 names the three drafts this
contradicts.

## 8. Acceptance

1. `git log --follow apps/mobile/src/wallet/wallet.ts` reaches the app's first commits.
2. From a clean clone: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check` and
   `npm test` pass, with the same results as `main` for everything that existed before.
3. `npm test --workspace=@pickler/mobile`: 44 suites, and every test that passed in `pickler-expo`.
4. The vectors pass in `packages/mera-account` and in the app.
5. `npx expo prebuild --platform ios --clean` and a simulator build succeed and the app reaches its
   first screen.
6. The docs tooling: `agents:check`, `agents:test` and `docs:check` pass from `scripts/mobile`.
7. The guard's tests pass, and the existing custody tests still do.
8. Not verified here, and said so in the pull request: a TestFlight archive (it needs the
   distribution certificate and `apps/mobile/.env.asc`), and opening an existing account on a
   device.

## 9. Risks

- **The native build is the fragile part.** If Expo cannot resolve native modules hoisted to the
  root, the fallback is to take `apps/mobile` out of the workspaces (the root `workspaces` lists
  `apps/web` and `apps/agent-service` by name), keep its own lockfile, and import the package by
  relative path. Acceptance item 5 is what detects it.
- **React moves down for the web.** Covered by the web's tests and typecheck.
- **The root lockfile changes**, so open branches conflict there when they update. Resolve by
  taking `main`'s lockfile and running `npm install`.
- **Secrets do not travel with git.** `.env.pickler` and `apps/mobile/.env.asc` are copied by hand.
- **Rollback** is reverting one merge commit. `pickler-expo` is untouched.

## 10. Out of scope

Mera on the web marketplace; SIWE sign-in from the app; one table of levels, leverage and read
rules; moving Perpl and reads behind `workers/api`; adopting this repository's lint and format in
the app; Android; archiving `pickler-expo`.

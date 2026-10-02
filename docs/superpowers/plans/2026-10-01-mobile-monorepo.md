# Mobile monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `Picklerfun/pickler-expo` into this repository with its history, make the app an npm workspace, extract the Mera derivation rule into `@pickler/mera-account` with frozen vectors, and keep Turnkey off Mera's relying party.

**Architecture:** A layout commit in a throwaway clone of `pickler-expo` moves its paths so nothing collides; a merge of unrelated histories brings it in. Follow-up commits fold the app into the workspaces, repoint its docs tooling at `docs/mobile/`, add the shared package and the custody guard. Spec: `docs/specs/mobile-monorepo-v1.md`.

**Tech Stack:** npm 10.9.3 workspaces, Turborepo, Expo 57 / React Native 0.86, `node:test` with `tsx`, Jest (`jest-expo`), `@scure/bip32` and `@scure/bip39` 2.3.0, Hono on Workers.

**What changed while executing (2026-10-01).** The plan below is kept as written; these four points
are where the work departed from it, and `docs/specs/mobile-monorepo-v1.md` §5 has the reasons.

- Task 3: the app's `viem` stays at 2.55.13, and the root lockfile was seeded with the app's own
  locked tree instead of being resolved afresh, which had moved a hundred transitive packages.
- Task 3: the root architecture check validates Markdown links, so the old repository README and
  one imported plan had their root-relative links corrected in Task 5.
- Task 4: the app drops its direct `@scure/bip32` and `@scure/bip39` dependencies (the package
  carries them), `jest.config.js` gains `modulePaths`, and the package typechecks `src` only.
- Task 8: `expo run:ios` wanted a signing certificate, so the simulator build is `xcodebuild` in
  Release with signing off, which also bundles the JavaScript through Metro.

**Conventions for every task:**

- Worktree: `/Users/Juvenal/Development/Pickler/pickler-mobile`, branch `codex/mobile-monorepo`. Never touch `../pickler` or `../pickler-turnkey`.
- Source of the app: `/Users/Juvenal/Development/pickler-expo` at `origin/main` (`138f4ad`). Read only.
- Scratch: `$S` = the session scratchpad directory.
- Install with `npx -y npm@10.9.3 …`, never the machine's npm 11.
- Commit with `git commit -- <paths>`; never `git add -A`, never `git stash`.

---

## File structure

| Path                                                                                      | Responsibility                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/mobile/`                                                                            | The Expo app, imported; workspace `@pickler/mobile`             |
| `apps/mobile/AGENTS.md`                                                                   | The app's rules, with the old repository root's rules folded in |
| `packages/mera-account/src/index.ts`                                                      | The derivation rule (was `apps/mobile/src/hd/hd.ts`)            |
| `packages/mera-account/test/vectors.json`                                                 | Frozen vectors, produced by the app's code before the move      |
| `packages/mera-account/test/derivation.test.ts`                                           | The rule against the vectors                                    |
| `apps/mobile/__tests__/hd.test.ts`                                                        | The same vectors through the app's resolver                     |
| `packages/core/src/features/wallets/domain/relying-party.ts`                              | `MERA_RELYING_PARTY`, `turnkeyRelyingPartyProblem`              |
| `workers/api/src/container.ts`                                                            | Custody is not composed on a refused relying party              |
| `scripts/mobile/`                                                                         | Imported docs and agent tooling, repointed at `docs/mobile/`    |
| `docs/mobile/`                                                                            | Imported documentation, unchanged except its instruction files  |
| `services/reads/`, `infra/`                                                               | Imported, unchanged, each with a new `AGENTS.md`                |
| `.github/workflows/mobile.yml`                                                            | CI for the app, the vectors, the tooling and the reads service  |
| `package.json`, `package-lock.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs` | Root integration                                                |

---

### Task 1: Freeze the vectors and the app's resolved versions, from the untouched checkout

**Files:**

- Create: `$S/gen-vectors.ts`, `$S/vectors.json`, `$S/app-versions-before.json`

- [ ] **Step 1: Write the generator, importing the app's own `hd.ts`**

```ts
// $S/gen-vectors.ts — run from pickler-expo/apps/mobile so its node_modules resolve.
import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "./src/hd/hd";

const inputs = [
  new Uint8Array(32).fill(0x00),
  new Uint8Array(32).fill(0x07),
  new Uint8Array(32).fill(0xff),
  Uint8Array.from({ length: 32 }, (_, i) => i),
  Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff),
];
const vectors = inputs.map((prf) => {
  const mnemonic = prfOutputToMnemonic(prf);
  const seed = mnemonicToSeed(mnemonic);
  const accounts = [0, 1].map((index) => {
    const privateKey = toHex(deriveEvmPrivateKey(seed, index));
    return { index, privateKey, address: privateKeyToAccount(privateKey).address };
  });
  return { prfOutput: toHex(prf), mnemonic, accounts };
});
writeFileSync(
  process.argv[2]!,
  `${JSON.stringify({ rule: "prf -> bip39(24, english) -> seed('') -> m/44'/60'/0'/0/index", vectors }, null, 2)}\n`,
);
```

- [ ] **Step 2: Run it in the untouched app**

```bash
cd /Users/Juvenal/Development/pickler-expo/apps/mobile
cp "$S/gen-vectors.ts" ./gen-vectors.tmp.ts && npx -y tsx ./gen-vectors.tmp.ts "$S/vectors.json"; rm ./gen-vectors.tmp.ts
git status --short   # expected: empty
```

Expected: `$S/vectors.json` with 5 vectors, each with a 24-word mnemonic and two accounts.

- [ ] **Step 3: Record what the app resolves today**

```bash
node -e '
const l=require("/Users/Juvenal/Development/pickler-expo/apps/mobile/package-lock.json").packages;
const out={};for(const [k,v] of Object.entries(l)){if(k&&!v.link)out[k]=v.version}
require("fs").writeFileSync(process.argv[1],JSON.stringify(out,null,1))' "$S/app-versions-before.json"
```

---

### Task 2: The layout commit and the merge

**Files:** every path of `pickler-expo`, moved as the spec's §3 says.

- [ ] **Step 1: Clone and rearrange**

```bash
git clone -q /Users/Juvenal/Development/pickler-expo "$S/expo-layout" && cd "$S/expo-layout"
git checkout -q -b monorepo-layout origin/main
git mv docs mobile-docs && mkdir docs && git mv mobile-docs docs/mobile
git mv scripts mobile-scripts && mkdir scripts && git mv mobile-scripts scripts/mobile
git mv package.json scripts/mobile/package.json
git mv package-lock.json scripts/mobile/package-lock.json
git mv README.md docs/mobile/README.md
git mv CLAUDE.md apps/mobile/REPOSITORY-RULES.md   # folded into AGENTS.md in Task 3; moved, not deleted, so its history follows
git rm -q AGENTS.md .gitignore
git commit -q -m "Rearrange pickler-expo for its move into the Pickler monorepo"
git ls-files | awk -F/ '{print $1}' | sort -u   # expected: .agents .claude apps docs infra scripts services
```

- [ ] **Step 2: Merge into the worktree**

```bash
cd /Users/Juvenal/Development/Pickler/pickler-mobile
git fetch -q "$S/expo-layout" monorepo-layout
git merge --allow-unrelated-histories --no-edit -m "Merge pickler-expo: the mobile marketplace app, its reads service and its documentation" FETCH_HEAD
git log --oneline --follow apps/mobile/src/wallet/wallet.ts | tail -1   # expected: one of the app's first commits
git ls-files -ci --exclude-standard   # expected: empty (no imported file is ignored by the root .gitignore)
```

Expected: a merge commit with no conflicts.

---

### Task 3: Fold the app into the workspaces

**Files:**

- Modify: `package.json`, `package-lock.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `apps/mobile/package.json`, `apps/mobile/AGENTS.md`
- Delete: `apps/mobile/package-lock.json`, `apps/mobile/REPOSITORY-RULES.md`

- [ ] **Step 1: The app's package**

In `apps/mobile/package.json`: `"name": "@pickler/mobile"`, `"version": "0.0.0"`, `"viem": "2.56.8"`, and a script `"typecheck": "tsc --noEmit"`. `git rm apps/mobile/package-lock.json`.

- [ ] **Step 2: The root package**

In `package.json` add:

```json
"overrides": {
  "react": "19.2.3",
  "react-dom": "19.2.3"
}
```

- [ ] **Step 3: Ignore lists**

Append to `.gitignore`:

```
# The mobile app (apps/mobile has its own .gitignore for native folders)
apps/mobile/build/
docs/mobile/fuentes/*.mp4
.claude/worktrees/
.claude/settings.local.json
.superpowers/
```

Append to `.prettierignore`:

```
# Imported with the mobile app; its own style and a Spanish record (docs/specs/mobile-monorepo-v1.md §5)
apps/mobile/
services/reads/
infra/
docs/mobile/
scripts/mobile/
.agents/
.claude/
```

In `eslint.config.mjs`, add to `globalIgnores([...])`:

```js
    // Imported with the mobile app; linted by its own tooling, not this configuration.
    "apps/mobile/**",
    "services/reads/**",
    "infra/**",
    "docs/mobile/**",
    "scripts/mobile/**",
```

- [ ] **Step 4: Install and compare**

```bash
npx -y npm@10.9.3 install --no-audit --no-fund
node "$S/compare-versions.mjs"   # written in this step: for every top-level name in app-versions-before.json, the version Node resolves from apps/mobile now; prints every difference
```

`$S/compare-versions.mjs`:

```js
import { readFileSync, existsSync } from "node:fs";
const before = JSON.parse(readFileSync(new URL("./app-versions-before.json", import.meta.url)));
const root = "/Users/Juvenal/Development/Pickler/pickler-mobile";
const now = (name) => {
  for (const dir of [`${root}/apps/mobile/node_modules/${name}`, `${root}/node_modules/${name}`]) {
    if (existsSync(`${dir}/package.json`))
      return JSON.parse(readFileSync(`${dir}/package.json`)).version;
  }
  return null;
};
let same = 0;
const diff = [];
for (const [key, version] of Object.entries(before)) {
  if (key.lastIndexOf("node_modules/") !== 0) continue; // top level of the app's tree only
  const name = key.slice("node_modules/".length);
  const resolved = now(name);
  if (resolved === version) same++;
  else diff.push(`${name}: ${version} -> ${resolved}`);
}
console.log(`${same} unchanged, ${diff.length} changed`);
console.log(diff.join("\n"));
```

Expected: `react`, `react-native`, `expo` and every direct dependency of the app unchanged except `viem`. Record the list of changed transitive packages for the pull request.

- [ ] **Step 5: The app's instructions**

Rewrite `apps/mobile/AGENTS.md` in English: the Expo warning it already carries, then the rules of `REPOSITORY-RULES.md` that still apply (Spanish for the app's docs and commits is dropped in favour of the root rules; no TestFlight build or upload without explicit authorisation; the bounty deadline of 2026-10-13 21:59 CST; where the docs contract and the three skills live; the app installs from the repository root). `git rm apps/mobile/REPOSITORY-RULES.md`. `apps/mobile/CLAUDE.md` stays `@AGENTS.md`.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck                                # expected: all tasks successful, @pickler/mobile among them
npm test --workspace=@pickler/mobile             # expected: 44 suites, 301 tests
npm run lint && npm run format:check             # expected: clean
git add package.json package-lock.json .gitignore .prettierignore eslint.config.mjs apps/mobile
git commit -m "Mobile: the app is a workspace under the root lockfile" -- package.json package-lock.json .gitignore .prettierignore eslint.config.mjs apps/mobile
```

---

### Task 4: `@pickler/mera-account`

**Files:**

- Create: `packages/mera-account/package.json`, `tsconfig.json`, `AGENTS.md`, `test/vectors.json`, `test/derivation.test.ts`
- Move: `apps/mobile/src/hd/hd.ts` → `packages/mera-account/src/index.ts`
- Modify: `apps/mobile/src/wallet/wallet.ts`, `apps/mobile/__tests__/hd.test.ts`, `apps/mobile/package.json`, `package.json` (test glob)

- [ ] **Step 1: The failing test**

`packages/mera-account/test/derivation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "../src/index.js";
import frozen from "./vectors.json" with { type: "json" };

// These vectors were produced by the app's code before it moved here (mobile-monorepo-v1 §6).
// A change that makes them fail moves every account. Fix the change, never the file.
for (const vector of frozen.vectors) {
  test(`PRF ${vector.prfOutput.slice(0, 10)}… derives its recorded accounts`, () => {
    const mnemonic = prfOutputToMnemonic(hexToBytes(vector.prfOutput as `0x${string}`));

    assert.equal(mnemonic, vector.mnemonic);

    const seed = mnemonicToSeed(mnemonic);
    for (const account of vector.accounts) {
      const privateKey = toHex(deriveEvmPrivateKey(seed, account.index));

      assert.equal(privateKey, account.privateKey);
      assert.equal(privateKeyToAccount(privateKey).address, account.address);
    }
  });
}

test("a PRF output that is not 32 bytes is refused", () => {
  assert.throws(() => prfOutputToMnemonic(new Uint8Array(31)), /32 bytes/);
});
```

Copy `$S/vectors.json` to `packages/mera-account/test/vectors.json`.

`packages/mera-account/package.json`:

```json
{
  "name": "@pickler/mera-account",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./vectors.json": "./test/vectors.json"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@scure/bip32": "2.3.0",
    "@scure/bip39": "2.3.0"
  },
  "devDependencies": {
    "@pickler/typescript-config": "*",
    "viem": "2.56.8"
  }
}
```

`packages/mera-account/tsconfig.json`:

```json
{
  "extends": "@pickler/typescript-config/base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 2: Run it and see it fail**

```bash
npx -y npm@10.9.3 install --no-audit --no-fund
node --import tsx --test packages/mera-account/test/*.test.ts
```

Expected: FAIL, cannot find `../src/index.js`.

- [ ] **Step 3: Move the rule**

```bash
mkdir -p packages/mera-account/src && git mv apps/mobile/src/hd/hd.ts packages/mera-account/src/index.ts
```

Translate its three comments to English; change no code. In `apps/mobile/src/wallet/wallet.ts` replace `from "../hd/hd"` with `from "@pickler/mera-account"`. Add `"@pickler/mera-account": "*"` to the app's dependencies. In the root `package.json` `test` script add `packages/mera-account/test/*.test.ts` after `packages/chain/test/*.test.ts`.

- [ ] **Step 4: The app's test reads the same vectors**

Replace `apps/mobile/__tests__/hd.test.ts`:

```ts
import { hexToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "@pickler/mera-account";
import frozen from "@pickler/mera-account/vectors.json";

// The same file packages/mera-account tests itself against, resolved the way the app resolves it.
test.each(frozen.vectors)("PRF $prfOutput derives its recorded accounts", (vector) => {
  const mnemonic = prfOutputToMnemonic(hexToBytes(vector.prfOutput as `0x${string}`));
  expect(mnemonic).toBe(vector.mnemonic);
  const seed = mnemonicToSeed(mnemonic);
  for (const account of vector.accounts) {
    const privateKey = toHex(deriveEvmPrivateKey(seed, account.index));
    expect(privateKey).toBe(account.privateKey);
    expect(privateKeyToAccount(privateKey).address).toBe(account.address);
  }
});

test("rejects PRF output that is not 32 bytes", () => {
  expect(() => prfOutputToMnemonic(new Uint8Array(31))).toThrow("32 bytes");
});
```

- [ ] **Step 5: Run both, then commit**

```bash
npx -y npm@10.9.3 install --no-audit --no-fund
node --import tsx --test packages/mera-account/test/*.test.ts    # expected: 6 pass
npm test --workspace=@pickler/mobile                             # expected: 44 suites pass
npm run typecheck                                                # expected: all successful
git add packages/mera-account apps/mobile package.json package-lock.json
git commit -m "Mera account: one derivation rule, with vectors frozen from the app" -- packages/mera-account apps/mobile package.json package-lock.json
```

`packages/mera-account/AGENTS.md` is written in this task: what the rule is, that the vectors are never regenerated, that the package stays free of React, React Native, the Mera SDK and run-time viem.

---

### Task 5: The docs tooling points at `docs/mobile/`

**Files:**

- Modify: `scripts/mobile/package.json`, `scripts/mobile/docs-md-to-html.mjs`, `scripts/mobile/agent-infra/check.mjs`, `check.test.mjs`, `check-changed-docs.mjs`, `render-check.mjs`, `generator.test.mjs`, `README.md`
- Modify: `.agents/skills/pickler-*/SKILL.md`, `docs/mobile/agent-reference.md`, `docs/mobile/README.md`, `apps/mobile/README.md`, `services/reads/README.md`
- Swap: `docs/mobile/CLAUDE.md` ↔ `docs/mobile/AGENTS.md`
- Regenerate: `docs/mobile/superpowers/{specs,plans}/*.html`

- [ ] **Step 1: Instruction files swap**

```bash
git rm -q docs/mobile/AGENTS.md && git mv docs/mobile/CLAUDE.md docs/mobile/AGENTS.md && printf '@AGENTS.md\n' > docs/mobile/CLAUDE.md
```

- [ ] **Step 2: `scripts/mobile/package.json`**

Name `pickler-mobile-tooling`; scripts lose their `scripts/` prefix: `node agent-infra/check.mjs`, `bash test-lock.sh node --test --test-concurrency=1 agent-infra/*.test.mjs`, `node agent-infra/branches.mjs`, `node docs-md-to-html.mjs --all`, `node docs-md-to-html.mjs --all --check`.

- [ ] **Step 3: The generator**

In `scripts/mobile/docs-md-to-html.mjs`: `REPO_ROOT = path.resolve(__dirname, '../..')`, `DOCS_ROOT = path.join(REPO_ROOT, 'docs/mobile')`, the two `includes('/docs/superpowers/…')` become `'/docs/mobile/superpowers/…'`, and every string it writes into a page changes `scripts/docs-md-to-html.mjs` → `scripts/mobile/docs-md-to-html.mjs`, `docs/superpowers/` → `docs/mobile/superpowers/`, `docs/CLAUDE.md` → `docs/mobile/AGENTS.md`.

- [ ] **Step 4: The checker**

In `scripts/mobile/agent-infra/check.mjs`: the default root is `join(HERE, '../../..')`; `docs/overview` → `docs/mobile/overview`; `docs/superpowers` → `docs/mobile/superpowers`. The instruction rules apply only to files under `apps/mobile/`, `docs/mobile/`, `services/reads/`, `infra/`, `scripts/mobile/` and `packages/mera-account/`, and become: an `AGENTS.md` there is a real file; a `CLAUDE.md` there has an `AGENTS.md` beside it and its content is exactly `@AGENTS.md`; the chain to the repository root stays under 24 KiB. `check.test.mjs` fixtures follow the same layout.

`check-changed-docs.mjs`: the path filter becomes `^docs\/mobile\/superpowers\/(specs|plans)\/…` and it calls `scripts/mobile/docs-md-to-html.mjs`. `render-check.mjs`: `docs/overview` → `docs/mobile/overview`.

- [ ] **Step 5: Paths in living instructions**

In the three `SKILL.md`, `docs/mobile/AGENTS.md`, `docs/mobile/agent-reference.md`, `scripts/mobile/agent-infra/README.md`, `docs/mobile/README.md`, `apps/mobile/README.md` and `services/reads/README.md`: path mentions `docs/…` → `docs/mobile/…`, `scripts/…` → `scripts/mobile/…`, and `npm run <agents|docs>:…` gains `--prefix scripts/mobile`. Specs, plans, audits and overviews are a dated record and keep the paths they were written with; `docs/mobile/AGENTS.md` says so in one sentence.

- [ ] **Step 6: Regenerate, verify, commit**

```bash
npx -y npm@10.9.3 ci --prefix scripts/mobile --no-audit --no-fund
npm run docs:html --prefix scripts/mobile
npm run docs:check --prefix scripts/mobile      # expected: processed=32 errors=0
npm run agents:check --prefix scripts/mobile    # expected: "errors": []
npm run agents:test --prefix scripts/mobile     # expected: all pass
git add scripts/mobile docs/mobile .agents apps/mobile/README.md services/reads/README.md
git commit -m "Mobile docs tooling: repointed at docs/mobile, instruction files follow this repository's convention" -- scripts/mobile docs/mobile .agents apps/mobile/README.md services/reads/README.md
```

---

### Task 6: Custody refuses Mera's relying party

**Files:**

- Create: `packages/core/src/features/wallets/domain/relying-party.ts`, `packages/core/test/relying-party.test.ts`
- Modify: `packages/core/src/index.ts`, `workers/api/src/container.ts`, `workers/api/test/container-chain.test.ts` (new cases beside the chain ones), `packages/core/AGENTS.md`, `workers/api/AGENTS.md`, `workers/api/.dev.vars.example`

- [ ] **Step 1: The failing test**

`packages/core/test/relying-party.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MERA_RELYING_PARTY,
  turnkeyRelyingPartyProblem,
} from "../src/features/wallets/domain/relying-party.js";

test("Mera's relying party is the apex", () => {
  assert.equal(MERA_RELYING_PARTY, "pickler.fun");
});

test("the studio host is accepted in a deployed environment", () => {
  assert.equal(turnkeyRelyingPartyProblem("app.pickler.fun", "production"), null);
  assert.equal(turnkeyRelyingPartyProblem("app.pickler.fun", "staging"), null);
});

test("Mera's relying party is refused everywhere, in any spelling", () => {
  for (const appEnv of ["local", "development", "staging", "production"]) {
    assert.equal(turnkeyRelyingPartyProblem("pickler.fun", appEnv), "shared_with_mera");
    assert.equal(turnkeyRelyingPartyProblem(" Pickler.Fun. ", appEnv), "shared_with_mera");
  }
});

test("localhost is for local development only", () => {
  assert.equal(turnkeyRelyingPartyProblem("localhost", "local"), null);
  assert.equal(turnkeyRelyingPartyProblem("localhost", "development"), null);
  assert.equal(turnkeyRelyingPartyProblem("localhost", "staging"), "localhost_deployed");
  assert.equal(turnkeyRelyingPartyProblem("localhost", "production"), "localhost_deployed");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test packages/core/test/relying-party.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: The rule**

`packages/core/src/features/wallets/domain/relying-party.ts`:

```ts
/**
 * The relying party Mera's passkey is enrolled against, on the web and in the app
 * (docs/specs/mobile-monorepo-v1.md W1). With WebAuthn PRF an assertion for it is the seed of the
 * marketplace wallet, so no other credential may share it.
 */
export const MERA_RELYING_PARTY = "pickler.fun";

export type RelyingPartyProblem = "shared_with_mera" | "localhost_deployed";

const LOCAL_ENVIRONMENTS = new Set(["local", "development"]);

/**
 * Why Turnkey custody must not be composed with this relying party, or null when it may.
 *
 * A Turnkey passkey authorises activities; Mera's is turned into key material. Enrolled against the
 * same relying party they appear in one picker, and the choice cannot be undone for anyone who has
 * enrolled. `localhost` outside local development is a deployment that kept its development value.
 */
export function turnkeyRelyingPartyProblem(
  rpId: string,
  appEnv: string,
): RelyingPartyProblem | null {
  const host = rpId.trim().toLowerCase().replace(/\.$/, "");

  if (host === MERA_RELYING_PARTY) {
    return "shared_with_mera";
  }
  if (host === "localhost" && !LOCAL_ENVIRONMENTS.has(appEnv)) {
    return "localhost_deployed";
  }
  return null;
}
```

Export both from `packages/core/src/index.ts` beside the other `wallets/domain` exports.

- [ ] **Step 4: The container**

In `custodyServices` of `workers/api/src/container.ts`, after the existing all-bindings check:

```ts
const problem = turnkeyRelyingPartyProblem(rpId, env.APP_ENV);
if (problem) {
  log(`TURNKEY_RPID is refused (${problem}); custody is off and /v1/signing is not mounted`);
  return undefined;
}
```

with `log: (message: string) => void = console.error` as a last parameter, the pattern `supportedChainId` already uses. A test beside the chain ones in `workers/api/test/container-chain.test.ts`: with `TURNKEY_RPID: "pickler.fun"` `createServices(env).custody` is `undefined`, `/v1/health` answers 200, and the log names `TURNKEY_RPID`; with `app.pickler.fun` and `APP_ENV: "staging"` custody is composed.

- [ ] **Step 5: Run, then commit**

```bash
npm run build:shared
node --import tsx --test packages/core/test/relying-party.test.ts workers/api/test/container-chain.test.ts
npm run typecheck
git add packages/core workers/api
git commit -m "Custody: Turnkey is never composed on Mera's relying party" -- packages/core workers/api
```

`workers/api/.dev.vars.example`, `workers/api/AGENTS.md` and `packages/core/AGENTS.md` change in the same commit: the deployed value is `app.pickler.fun`, and the guard is described.

---

### Task 7: Documents, project map, CI

**Files:**

- Modify: `AGENTS.md`, `docs/specs/product-hosts-v1.md`, `docs/specs/turnkey-passkey-custody-v1.md`, `docs/specs/user-profiles-and-products-v1.md`, `apps/web/AGENTS.md`, `apps/web/public/_headers` (comment only)
- Create: `services/reads/AGENTS.md`, `infra/AGENTS.md`, `scripts/mobile/AGENTS.md`, `.github/workflows/mobile.yml`

- [ ] **Step 1: Superseding notes.** At the top of `product-hosts-v1.md`, a dated block: §3 and §4 are superseded by `mobile-monorepo-v1.md` W1–W2 (Mera on `pickler.fun`, Turnkey on `app.pickler.fun`, two hosts). The production value in `turnkey-passkey-custody-v1.md` and the two notes in `user-profiles-and-products-v1.md` name `app.pickler.fun`. The paragraph of `apps/web/AGENTS.md` on the retired PRF signer gains one sentence: Turnkey's relying party is `app.pickler.fun`, never `pickler.fun`, and the API refuses to compose custody otherwise.

- [ ] **Step 2: The project map.** Root `AGENTS.md` gains rows for `apps/mobile`, `packages/mera-account`, `services/reads`, `infra` and `scripts/mobile`, the language exception for the imported Spanish record, and the two commands that are not under Turborepo (`npm test --workspace=@pickler/mobile`, `npm run agents:check --prefix scripts/mobile`). The three new `AGENTS.md` are short and in English, each pointing at the README that already holds the detail.

- [ ] **Step 3: CI.** `.github/workflows/mobile.yml`:

```yaml
name: Mobile
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.22.0
          cache: npm
      - run: npm install --global npm@10.9.3
      - run: npm ci
      - run: npm run typecheck --workspace=@pickler/mobile
      - run: npm test --workspace=@pickler/mobile
      - run: node --import tsx --test packages/mera-account/test/*.test.ts
  tooling:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22.22.0
      - run: npm install --global npm@10.9.3
      - run: npm ci --prefix scripts/mobile
      - run: npm run agents:check --prefix scripts/mobile
      - run: npm run agents:test --prefix scripts/mobile
      - run: npm run docs:check --prefix scripts/mobile
  reads:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.22.0
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: npm install --global npm@10.9.3
      - run: npm ci --prefix services/reads
      - run: npm test --prefix services/reads
```

- [ ] **Step 4: Verify and commit**

```bash
npm run format:check && npm run lint
npm run agents:check --prefix scripts/mobile   # the new AGENTS.md files are inside its scope
git add AGENTS.md docs/specs apps/web/AGENTS.md apps/web/public/_headers services/reads/AGENTS.md infra/AGENTS.md scripts/mobile/AGENTS.md .github/workflows/mobile.yml
git commit -m "Mobile: the project map, the relying parties in the documents, and CI" -- AGENTS.md docs/specs apps/web/AGENTS.md apps/web/public/_headers services/reads/AGENTS.md infra/AGENTS.md scripts/mobile/AGENTS.md .github/workflows/mobile.yml
```

---

### Task 8: Verify the whole, natively too

- [ ] **Step 1: From clean**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules workers/*/node_modules
npx -y npm@10.9.3 ci --no-audit --no-fund
npm run typecheck && npm run lint && npm run format:check && npm test
npm test --workspace=@pickler/mobile
npm run build
```

Expected: the baseline's 1,876 passing tests plus the new ones; the app's 44 suites; a successful build.

- [ ] **Step 2: The native build**

```bash
cd apps/mobile && npx expo prebuild --platform ios --clean && npx expo run:ios --no-bundler
```

Expected: pods install, the build succeeds and the app installs on the simulator. Then start Metro (`npx expo start`), open the app and take a screenshot of the first screen with `xcrun simctl io booted screenshot`. If autolinking or Metro cannot resolve a module, apply the spec's §9 fallback and record it.

- [ ] **Step 3: Record the results** in the pull request body: what ran, what did not (TestFlight archive, an existing account on a device), and the list of transitive packages whose version changed.

---

### Task 9: Deliver

- [ ] Push `codex/mobile-monorepo` and open a pull request against `main`.
- [ ] Comment on PR #65: the relying parties of `product-hosts-cutover-v2.md`, the derivation of `marketplace-wallets-v1.md` D2–D3 and the open questions of `mobile-backend-v1.md` §10.3 are answered by this change, with the answers.
- [ ] Not done here, and said so: merging the pull request, the notice in `pickler-expo`'s README (after the merge), a TestFlight build.

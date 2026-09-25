# Studio: Create, Watch It Think, Fund — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person types one line, gets an agent with a wallet whose rules they approved with their
passkey, watches its first run decide on paper, funds it, and can turn its schedule on.

**Architecture:** The studio is renamed from `console` first. Creation is a model-drafted config
(`AgentDrafter` port, OpenAI-compatible adapter) mapped by pure functions onto `AgentConfig`, which
gains `sources` and `skills`. The wallet ceremony reuses the existing unsigned-activity pattern
(API builds the body, the browser stamps it with the passkey, the API forwards it): one
`createUsers` for Pickler's delegated user (first agent only), one `createWallet`, one
`createPolicies` — then the agent is created with the wallet linked in the same transaction. The
first run is the existing enqueue + events polling. Funding is an ERC-20 transfer built by the API,
stamped by the passkey, broadcast by the API; balances are read over JSON-RPC. Locks are pure
functions the API answers in the DTO.

**Tech Stack:** Hono on Workers, Postgres via `pg` + Drizzle migrations, Turnkey (`@turnkey/http`
server, `@turnkey/webauthn-stamper` browser), Next.js 16, `node:test`, Playwright design checks.

**Spec:** `docs/specs/studio-create-and-fund-v1.md`. Read §3 (field → destination) and §4 (the
ceremony) before Task 2.

---

## Orientation

**Two adjustments to the spec, made while planning, and why.**

1. **Passkey prompts.** Turnkey's `createSubOrganization` takes one `wallet` and only `rootUsers`,
   and there is no batch-activity endpoint. So the first agent's ceremony is: `register` (sub-org +
   master wallet) → `createUsers` (delegated) → `createWallet` (agent) → `createPolicies` — **four
   prompts** on the first agent, **two** on every later one. The spec said "two at most"; that was
   wrong. The screen shows a four-step rail so nobody thinks a prompt is a repeat.
2. **The automatic paper order** is triggered by the studio when it sees the run complete with
   `action: "TRADE"` (the route exists and is idempotent), not by a runtime hook. A hook in the
   research worker is a follow-up; the person is watching the first run, so the client trigger
   covers this plan.

**What exists and must be reused.**

| Thing                                | Where                                                                                                                                                                                                                                                 | Reuse for                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unsigned-activity pattern            | `packages/core/src/features/wallets/application/custody.ts:182–230` (`prepareAddPasskey` / `confirmAddPasskey`), builder in `packages/infrastructure/src/turnkey/turnkey-sub-organization.ts:127`, routes `workers/api/src/routes/signing.ts:236–292` | delegated user, agent wallet, policies, deposit signing                                                |
| Activity forwarder with expectations | `packages/core/src/features/signing/domain/turnkey-activity.ts:40–52`, `packages/infrastructure/src/turnkey/turnkey-activity-forwarder.ts`                                                                                                            | every stamped activity above                                                                           |
| Sub-org creation                     | `turnkey-sub-organization.ts:54–118`                                                                                                                                                                                                                  | unchanged; the delegated user is added after                                                           |
| Custody store                        | `packages/infrastructure/src/persistence/custody-store.ts`                                                                                                                                                                                            | new methods beside `saveRegistration`                                                                  |
| Create-agent transaction             | `packages/infrastructure/src/console/directory.ts:70–160`                                                                                                                                                                                             | gains the `agent_wallets` insert                                                                       |
| Research repository                  | `packages/core/src/features/research/types.ts:272–297` (`enqueue`, `events`, `event`, `run`)                                                                                                                                                          | first run, wallet-linked event                                                                         |
| Paper service                        | `packages/core/src/features/paper/orders.ts:261`, route `console.ts:181`                                                                                                                                                                              | auto paper order                                                                                       |
| Budget ledger                        | `packages/core/src/features/budget/domain/ledger.ts:339` `configure(limits)` (micro-USD), `packages/infrastructure/src/console/budget.ts`                                                                                                             | limits                                                                                                 |
| Chain metadata                       | `packages/chain/src/networks.ts` (`MONAD_TESTNET.publicRpcUrls`, `AUSD[10143]`)                                                                                                                                                                       | balance, deposit                                                                                       |
| Web create flow (old canvas)         | `apps/web/src/features/console/empty/*`                                                                                                                                                                                                               | replaced by Task 11; `passkey-sheet.tsx`, `piece.tsx` and the polling helper `lib/polling.ts` are kept |
| Web API helper                       | `apps/web/src/features/console/api.ts` (`consoleApi<T>(path, init)`)                                                                                                                                                                                  | renamed `studioApi` in Task 1                                                                          |

**Facts, verified.** `AgentConfig` (`core/research/types.ts:33`) has `profile`, `tools`,
`plugins`, `marketScope`, `limits`, `intervalHours`, `uncertaintyPolicy`, `discoveryPolicy`,
`researchProtocol`. `PLUGIN_IDS`: polymarket, exa, balldontlie, the-odds-api, paper-trading,
polymarket-trading. `DEFAULT_UNCERTAINTY_POLICY`: margin 0.01, width 0.2. `RunRecord.status ∈
queued|running|completed|failed|cancelled`, `decision: Decision | null`, `startedAt/finishedAt`.
`wallets.turnkey_orgs (user_id pk, sub_organization_id, master_wallet_id, root_user_id)`;
`wallets.wallets (id, user_id, wallet_id unique, sub_organization_id, kind master|agent, name)`;
`wallets.wallet_accounts (wallet_id, chain 'monad', address, address_format, path)`. Turnkey
activity types in the vendored SDK: `ACTIVITY_TYPE_CREATE_USERS_V3`, `ACTIVITY_TYPE_CREATE_WALLET`,
`ACTIVITY_TYPE_CREATE_POLICIES`, `ACTIVITY_TYPE_SIGN_TRANSACTION_V2`. The web stamps with
`@turnkey/webauthn-stamper` 0.6.0; the server uses `@turnkey/http` + `@turnkey/api-key-stamper`.
`workers/api` may import `@pickler/core`, `@pickler/infrastructure`, `@pickler/api-schema`, not
`@pickler/agent-runtime`. `apps/web/src` may import neither core nor infrastructure.

**Commands.** `npm run db:up` (Postgres 55432) · `npm run db:migrate` · one test file:
`node --import tsx --test <file>` · gates: `npm run typecheck`, `npm run lint`,
`npx prettier --check .`, `npm test` — **by exit status**. Design checks:
`DESIGN_BASE_URL=http://localhost:3001 node scripts/design/<check>.mjs`. Dev servers 3001 (web)
and 8787 (api) are this worktree's; the research worker is started in Task 15. Never start a
second copy of any of them.

**Rules.** Commit by path with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
trailer. Never `git clean`, `checkout .`, `reset --hard`, `restore`, bare `stash`. No secret
values in chat, logs or commits — names only. No literal colours in web CSS; tokens only. Prove
every test can fail by mutating what it pins. Failure propagates: no `catch` that turns "could not
read" into "empty".

---

## File structure

| File                                                                         | Responsibility                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/web/src/features/studio/**` (renamed)                                  | the studio                                                                              |
| `workers/api/src/routes/studio.ts` (renamed)                                 | `/v1/studio/*`                                                                          |
| `packages/core/src/features/studio/access.ts` (renamed)                      | `StudioAccess`, `StudioDirectory`                                                       |
| `packages/infrastructure/src/studio/directory.ts` (renamed)                  | `PostgresStudioDirectory`                                                               |
| `packages/core/src/features/research/types.ts`                               | `sources`, `skills` on `AgentConfig`                                                    |
| `packages/core/src/features/research/style.ts` **new**                       | the three presets ↔ policy                                                              |
| `packages/core/src/features/research/brief.ts` **new**                       | brief + skills composition                                                              |
| `packages/core/src/features/studio/draft.ts` **new**                         | `AgentDraft`, `AgentDrafter` port, `draftToConfig`, `SOON`                              |
| `packages/api-schema/src/studio.ts` (renamed)                                | schemas incl. `agentDraftSchema`, `sourcesSchema`, `skillSchema`                        |
| `packages/infrastructure/src/model/openai-compatible-drafter.ts` **new**     | the model call                                                                          |
| `packages/agent-runtime/src/plugins/exa.ts` (existing, modified)             | allow-list                                                                              |
| `packages/infrastructure/src/persistence/product/wallets.ts`                 | `agent_wallets`, `deposits`, `delegated_user_id`                                        |
| `packages/core/src/features/wallets/domain/agent-wallet-policies.ts` **new** | the three policies, pure                                                                |
| `packages/core/src/features/wallets/application/custody.ts`                  | prepare/confirm for delegated user, wallet, policies, deposit                           |
| `packages/infrastructure/src/turnkey/turnkey-activities.ts` **new**          | unsigned builders: createUsers, createWallet, createPolicies, signTransaction           |
| `packages/infrastructure/src/persistence/custody-store.ts`                   | `saveDelegatedUser`, `saveWallet`, `findAgentWallet`, `findOrphanWallet`, `saveDeposit` |
| `workers/api/src/routes/signing.ts`                                          | `/v1/signing/agents/*`                                                                  |
| `packages/core/src/features/studio/locks.ts` **new**                         | `canSchedule`, `canCreateAnother`                                                       |
| `packages/infrastructure/src/chain/erc20.ts` **new**                         | balance read, transfer calldata, nonce/gas, broadcast                                   |
| `apps/web/src/features/studio/create/**` **new**                             | the creation screens                                                                    |
| `apps/web/src/features/studio/home/**` **new**                               | Studio v5 home                                                                          |
| `scripts/design/routes.mjs`                                                  | routes per step and stage                                                               |

---

## Task 1: Rename `console` → `studio` in all three layers

**Files:** everything `grep -rlE "/console\b|consoleRoutes|ConsoleDirectory|ConsoleAccess|ConsoleServices|consoleApi|features/console|console\.module|/v1/console|\"console\"" apps/web/src apps/web/test workers/api/src workers/api/test packages/core/src packages/core/test packages/infrastructure/src packages/infrastructure/test packages/api-schema/src scripts/design *AGENTS.md` lists (39 files at plan time).

- [ ] **Step 1: Move the directories and files with git so history follows**

```bash
git mv apps/web/src/features/console apps/web/src/features/studio
git mv apps/web/src/app/console apps/web/src/app/studio
git mv workers/api/src/routes/console.ts workers/api/src/routes/studio.ts
git mv workers/api/test/console.test.ts workers/api/test/studio.test.ts 2>/dev/null || true
git mv workers/api/test/console-route.test.ts workers/api/test/studio-route.test.ts
git mv packages/core/src/features/console packages/core/src/features/studio
git mv packages/infrastructure/src/console packages/infrastructure/src/studio
git mv packages/infrastructure/test/console.test.ts packages/infrastructure/test/studio.test.ts
git mv packages/api-schema/src/console.ts packages/api-schema/src/studio.ts
```

Check `ls apps/web/src/app` first: the studio route may be `(studio)/console` or similar — move whatever directory serves `/console` so it serves `/studio`.

- [ ] **Step 2: Rename identifiers**

```bash
grep -rlE "consoleRoutes|ConsoleDirectory|ConsoleAccess|ConsoleServices|consoleApi|ConsoleError|createConsoleAccess|consoleAccess|PostgresConsoleDirectory|consoleAgentSchema|consoleOptionsSchema|consoleAccessSchema" apps/web/src apps/web/test workers/api/src workers/api/test packages/core/src packages/core/test packages/infrastructure/src packages/infrastructure/test packages/api-schema/src scripts/design \
 | xargs sed -i '' -E 's/consoleRoutes/studioRoutes/g; s/PostgresConsoleDirectory/PostgresStudioDirectory/g; s/ConsoleDirectory/StudioDirectory/g; s/createConsoleAccess/createStudioAccess/g; s/ConsoleAccess/StudioAccess/g; s/consoleAccessSchema/studioAccessSchema/g; s/ConsoleServices/StudioServices/g; s/consoleApi/studioApi/g; s/ConsoleError/StudioError/g; s/consoleAccess/studioAccess/g; s/consoleAgentSchema/studioAgentSchema/g; s/consoleOptionsSchema/studioOptionsSchema/g'
grep -rlE "features/console|/v1/console|\"/console|'/console|console\.module|\"console\"|\./console\"|routes/console|console/directory|console/budget|console/operator" apps/web/src apps/web/test workers/api/src workers/api/test packages/core/src packages/core/test packages/infrastructure/src packages/infrastructure/test packages/api-schema/src scripts/design \
 | xargs sed -i '' -E 's#features/console#features/studio#g; s#/v1/console#/v1/studio#g; s#"/console#"/studio#g; s#'"'"'/console#'"'"'/studio#g; s#console\.module#studio.module#g; s#routes/console#routes/studio#g; s#src/console/#src/studio/#g; s#\./console"#./studio"#g'
```

Then **read every remaining hit** of `grep -rn "console" apps/web/src/features/studio apps/web/src/server/hosts.ts workers/api/src/app.ts packages/api-schema/src/index.ts` that is not `console.log/error/warn` and rename by hand: the `"console"` string in `STUDIO_SEGMENTS` (`hosts.ts`) becomes `"studio"`; `PROTECTED_SEGMENTS` in `guard.ts` likewise; the api-schema index re-export path.

- [ ] **Step 3: Design harness and docs**

`scripts/design/routes.mjs`: every `path: "/console…"` → `"/studio…"`. Docs: `apps/web/AGENTS.md`,
`workers/api/AGENTS.md`, `packages/core/AGENTS.md`, `packages/infrastructure/AGENTS.md`,
`packages/api-schema/AGENTS.md`, `docs/specs/user-profiles-and-products-v1.md` ("Which routes live
where") and `product-hosts-v1.md` §1 table: `/console` → `/studio`, `console` → `studio`. Add one
line to `apps/web/AGENTS.md`: "The studio lived at `/console` until 2026-09-25; no redirect is kept
because nobody had launched."

- [ ] **Step 4: Gates and the routes**

```bash
npm run typecheck >/dev/null 2>&1; echo "typecheck=$?"
npm run lint >/dev/null 2>&1; echo "lint=$?"
npx prettier --check . >/dev/null 2>&1; echo "prettier=$?"
npm test >/dev/null 2>&1; echo "test=$?"
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3001/studio?state=empty'   # 200 or 307 (guard) — not 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/v1/studio/me            # 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/v1/console/me           # 404
grep -rn "console" apps/web/src workers/api/src packages/*/src | grep -v "console\.\(log\|error\|warn\|info\|debug\)" ; echo "leftovers-exit=$? (1 = none, good)"
```

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/features/studio apps/web/src/app workers/api packages/core packages/infrastructure packages/api-schema scripts/design docs apps/web/AGENTS.md
git commit -m "Call the studio by its name in the URL, the API and the code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git add -A` on these paths is right here: the renames are staged by `git mv` and the sed edits touch only files in them. Run `git status --short | grep -v "^[MRAD]"` first to confirm nothing untracked is swept in.)

---

## Task 2: `sources` and `skills` on the config; the three styles; the brief with skills

**Files:**

- Modify: `packages/core/src/features/research/types.ts:33–45` (`AgentConfig`), `:326–335` (`DEFAULT_CONFIG`), `assertConfig` (~`:350–380`)
- Create: `packages/core/src/features/research/style.ts`, `packages/core/src/features/research/brief.ts`
- Modify: `packages/api-schema/src/research.ts` (`agentConfigSchema`)
- Test: `packages/core/test/style.test.ts`, `packages/core/test/brief.test.ts`, extend `packages/core/test/research-config.test.ts` (or the file that tests `assertConfig` — `grep -rl assertConfig packages/core/test`)

- [ ] **Step 1: Failing tests**

```ts
// packages/core/test/style.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, policyForStyle, styleForPolicy } from "../src/features/research/style.js";

test("each style maps to its policy and back", () => {
  for (const style of STYLES) {
    const policy = policyForStyle(style);
    assert.equal(styleForPolicy(policy), style);
  }
});

test("the numbers are the ones the spec fixed", () => {
  assert.deepEqual(policyForStyle("careful"), {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.08,
    maxProbabilityRangeWidth: 0.15,
  });
  assert.deepEqual(policyForStyle("balanced"), {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.04,
    maxProbabilityRangeWidth: 0.2,
  });
  assert.deepEqual(policyForStyle("bold"), {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.02,
    maxProbabilityRangeWidth: 0.3,
  });
});

test("a hand-edited policy resolves to the closest style", () => {
  assert.equal(
    styleForPolicy({
      blockHighUncertainty: true,
      requireCompleteInformation: true,
      minProbabilityMargin: 0.07,
      maxProbabilityRangeWidth: 0.16,
    }),
    "careful",
  );
  assert.equal(
    styleForPolicy({
      blockHighUncertainty: true,
      requireCompleteInformation: true,
      minProbabilityMargin: 0.01,
      maxProbabilityRangeWidth: 0.2,
    }),
    "balanced",
    "the runtime default reads as balanced",
  );
});
```

```ts
// packages/core/test/brief.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBrief } from "../src/features/research/brief.js";

test("skills are appended as numbered rules, and the edge stays first", () => {
  const brief = composeBrief("It reads injury reports before the books move.", [
    { name: "Injury double-check", prompt: "Only count an injury if two sources confirm it." },
    {
      name: "Late line moves",
      prompt: "If the line moved more than 2 points in 24 hours, find out why.",
    },
  ]);
  assert.equal(
    brief,
    [
      "It reads injury reports before the books move.",
      "",
      "Rules it follows:",
      "1. Injury double-check — Only count an injury if two sources confirm it.",
      "2. Late line moves — If the line moved more than 2 points in 24 hours, find out why.",
    ].join("\n"),
  );
});

test("no skills means the edge alone, byte for byte", () => {
  assert.equal(composeBrief("Edge.", []), "Edge.");
});
```

Extend the `assertConfig` test file:

```ts
test("sources and skills are validated", () => {
  const base = {
    ...DEFAULT_CONFIG,
    marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
  };
  assertConfig({
    ...base,
    sources: { web: { mode: "only", sites: ["espn.com"] }, books: [] },
    skills: [],
  });
  assert.throws(
    () =>
      assertConfig({
        ...base,
        sources: { web: { mode: "only", sites: [] }, books: [] },
        skills: [],
      }),
    /INVALID_INPUT|at least one site/,
  );
  assert.throws(
    () =>
      assertConfig({
        ...base,
        sources: { web: null, books: [] },
        skills: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, prompt: "p" })),
      }),
    /INVALID_INPUT|skills/,
  );
  assert.throws(
    () =>
      assertConfig({
        ...base,
        sources: { web: null, books: [] },
        skills: [{ name: "x", prompt: "p".repeat(601) }],
      }),
    /INVALID_INPUT|600/,
  );
});
```

- [ ] **Step 2: Run, watch them fail** — `node --import tsx --test packages/core/test/style.test.ts packages/core/test/brief.test.ts; echo "exit=$?"` → non-zero (modules missing).

- [ ] **Step 3: Implement**

```ts
// packages/core/src/features/research/style.ts
import type { UncertaintyPolicy } from "./types.js";

/** Three ways to decide, as the studio asks. Balanced is stricter than the runtime default on purpose. */
export const STYLES = ["careful", "balanced", "bold"] as const;
export type Style = (typeof STYLES)[number];

const NUMBERS: Record<Style, { minProbabilityMargin: number; maxProbabilityRangeWidth: number }> = {
  careful: { minProbabilityMargin: 0.08, maxProbabilityRangeWidth: 0.15 },
  balanced: { minProbabilityMargin: 0.04, maxProbabilityRangeWidth: 0.2 },
  bold: { minProbabilityMargin: 0.02, maxProbabilityRangeWidth: 0.3 },
};

export function policyForStyle(style: Style): UncertaintyPolicy {
  return { blockHighUncertainty: true, requireCompleteInformation: true, ...NUMBERS[style] };
}

/** The closest style by Euclidean distance over the two numbers, so a hand-edited policy still reads as one. */
export function styleForPolicy(policy: UncertaintyPolicy): Style {
  let best: Style = "balanced";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const style of STYLES) {
    const n = NUMBERS[style];
    const distance =
      (n.minProbabilityMargin - policy.minProbabilityMargin) ** 2 +
      (n.maxProbabilityRangeWidth - policy.maxProbabilityRangeWidth) ** 2;
    if (distance < bestDistance) {
      best = style;
      bestDistance = distance;
    }
  }
  return best;
}
```

```ts
// packages/core/src/features/research/brief.ts
export interface Skill {
  name: string;
  prompt: string;
}

/** The brief the model reads: the edge, then the skills as numbered rules. Stored apart; joined here. */
export function composeBrief(edge: string, skills: readonly Skill[]): string {
  if (skills.length === 0) {
    return edge;
  }
  const rules = skills.map((skill, i) => `${i + 1}. ${skill.name} — ${skill.prompt}`);
  return [edge, "", "Rules it follows:", ...rules].join("\n");
}
```

In `types.ts`, add to `AgentConfig`:

```ts
  /** What it reads beyond market data. `web: null` means the web is off. */
  sources?: AgentSources | undefined;
  /** Routines the person added; appended to the brief at run time (see brief.ts). */
  skills?: Skill[] | undefined;
```

with

```ts
export type WebMode = "anywhere" | "prefer" | "only";
export interface AgentSources {
  web: { mode: WebMode; sites: string[] } | null;
  /** Sportsbooks the odds plugin may quote; empty means all it has. */
  books: string[];
}
export const MAX_SKILLS = 8;
export const MAX_SKILL_PROMPT = 600;
export const MAX_SITES = 20;
```

(import `Skill` from `./brief.js`). `DEFAULT_CONFIG` gains `sources: { web: { mode: "anywhere", sites: [] }, books: [] }, skills: []`. In `assertConfig`, after the uncertainty policy check:

```ts
if (config.sources) {
  const { web, books } = config.sources;
  if (web) {
    if (!["anywhere", "prefer", "only"].includes(web.mode)) {
      throw new PilotError("INVALID_INPUT", "Unknown web mode");
    }
    if (web.mode !== "anywhere" && web.sites.length === 0) {
      throw new PilotError("INVALID_INPUT", "Prefer and only need at least one site");
    }
    if (
      web.sites.length > MAX_SITES ||
      web.sites.some((s) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))
    ) {
      throw new PilotError("INVALID_INPUT", "Sites must be bare hostnames");
    }
  }
  if (!Array.isArray(books) || books.some((b) => typeof b !== "string" || b.length > 40)) {
    throw new PilotError("INVALID_INPUT", "Invalid books");
  }
}
if (config.skills) {
  if (config.skills.length > MAX_SKILLS) {
    throw new PilotError("INVALID_INPUT", `At most ${MAX_SKILLS} skills`);
  }
  for (const skill of config.skills) {
    if (
      !skill.name.trim() ||
      skill.name.length > 40 ||
      !skill.prompt.trim() ||
      skill.prompt.length > MAX_SKILL_PROMPT
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        `A skill needs a name (≤ 40) and a prompt (≤ ${MAX_SKILL_PROMPT})`,
      );
    }
  }
}
```

Export `style.ts` and `brief.ts` from `packages/core/src/index.ts`. Mirror in `packages/api-schema/src/research.ts`'s `agentConfigSchema`:

```ts
const skillSchema = z.object({ name: z.string().trim().min(1).max(40), prompt: z.string().trim().min(1).max(600) }).strict();
const sourcesSchema = z.object({
  web: z.object({ mode: z.enum(["anywhere", "prefer", "only"]), sites: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20) }).strict().nullable(),
  books: z.array(z.string().max(40)),
}).strict();
// on agentConfigSchema:
  sources: sourcesSchema.optional(),
  skills: z.array(skillSchema).max(8).optional(),
```

and export `skillSchema`, `sourcesSchema`, plus `STYLES = ["careful","balanced","bold"] as const` with `StyleDto = (typeof STYLES)[number]` in `packages/api-schema/src/studio.ts` (mirror comment as in `landing.ts`).

- [ ] **Step 4: Run, pass; mutate** — flip Careful's margin to 0.07 → "the numbers are the ones the spec fixed" reddens; revert. Remove the `""` line in `composeBrief` → the brief test reddens; revert.

- [ ] **Step 5: Gates and commit**

```bash
git commit -m "Let an agent say what it reads and which rules it follows, and name three ways to decide

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core/src packages/core/test packages/api-schema/src
```

---

## Task 3: The draft — port, mapping, adapter, route

**Files:**

- Create: `packages/core/src/features/studio/draft.ts`
- Create: `packages/api-schema/src/studio.ts` additions (`agentDraftSchema`)
- Create: `packages/infrastructure/src/model/openai-compatible-drafter.ts`
- Modify: `workers/api/src/routes/studio.ts`, `workers/api/src/container.ts`, `workers/api/src/env.ts`, `workers/api/.dev.vars.example`
- Test: `packages/core/test/draft.test.ts`, `packages/infrastructure/test/openai-compatible-drafter.test.ts`, `workers/api/test/studio-draft-route.test.ts`

- [ ] **Step 1: Failing core tests**

```ts
// packages/core/test/draft.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEATS,
  SOON_BEATS,
  SOON_VENUES,
  draftToConfig,
  unsupported,
  type AgentDraft,
} from "../src/features/studio/draft.js";

const draft: AgentDraft = {
  name: "Halftime",
  handle: "halftime",
  venues: ["polymarket"],
  beat: "Sports",
  subcategories: ["NFL"],
  sites: ["espn.com", "nfl.com"],
  skills: ["Injury double-check"],
  edge: "It reads injury reports before the books move.",
  style: "balanced",
  accent: "lime",
};

test("a supported draft maps onto a config the runtime accepts", () => {
  const config = draftToConfig(draft);
  assert.deepEqual(config.marketScope, {
    version: 1,
    category: "sports",
    subcategories: ["american-football"],
  });
  assert.deepEqual(config.sources, {
    web: { mode: "prefer", sites: ["espn.com", "nfl.com"] },
    books: [],
  });
  assert.equal(config.skills?.[0]?.name, "Injury double-check");
  assert.equal(config.profile, draft.edge);
  assert.equal(config.uncertaintyPolicy?.minProbabilityMargin, 0.04);
  assert.ok(config.tools.includes("searchWeb") && config.tools.includes("readPage"));
});

test("perpl and every beat but sports are reported as unsupported, not silently dropped", () => {
  assert.deepEqual(unsupported({ ...draft, venues: ["polymarket", "perpl"] }), ["venue:perpl"]);
  assert.deepEqual(unsupported({ ...draft, beat: "Economics", subcategories: ["Fed"] }), [
    "beat:Economics",
  ]);
  assert.deepEqual(unsupported(draft), []);
  assert.ok(SOON_VENUES.includes("perpl"));
  assert.ok(SOON_BEATS.includes("Crypto"));
});

test("a subcategory label maps to the runtime's sport id, and an unknown one is refused", () => {
  assert.throws(() => draftToConfig({ ...draft, subcategories: ["Cricket"] }), /Cricket/);
  assert.ok(
    BEATS.find((b) => b.name === "Sports")?.subs.some(
      (s) => s.label === "NFL" && s.id === "american-football",
    ),
  );
});
```

- [ ] **Step 2: Run, fail** — module missing.

- [ ] **Step 3: Implement the core**

```ts
// packages/core/src/features/studio/draft.ts
import type { Accent } from "../agents/domain/public-views.js";
import { DEFAULT_CONFIG, type AgentConfig, type ToolName } from "../research/types.js";
import type { SportId } from "../research/market-scope.js";
import { policyForStyle, type Style } from "../research/style.js";

export const VENUES_ON_MAP = ["polymarket", "perpl"] as const;
export type VenueOnMap = (typeof VENUES_ON_MAP)[number];
/** On the map, not yet decidable by the runtime. The form shows them disabled with "Soon". */
export const SOON_VENUES: readonly VenueOnMap[] = ["perpl"];

export interface Beat {
  name: string;
  accent: Accent;
  subs: { label: string; id: SportId | null }[];
}
/** The beats the canvas draws. Only Sports carries runtime ids; the rest are Soon. */
export const BEATS: readonly Beat[] = [
  {
    name: "Sports",
    accent: "lime",
    subs: [
      { label: "NFL", id: "american-football" },
      { label: "NBA", id: "basketball" },
      { label: "Soccer", id: "soccer" },
      { label: "Tennis", id: "tennis" },
    ],
  },
  {
    name: "Crypto",
    accent: "blue",
    subs: [
      { label: "Bitcoin", id: null },
      { label: "Ethereum", id: null },
      { label: "New listings", id: null },
    ],
  },
  {
    name: "Politics",
    accent: "violet",
    subs: [
      { label: "US elections", id: null },
      { label: "Congress", id: null },
      { label: "World", id: null },
    ],
  },
  {
    name: "Economics",
    accent: "amber",
    subs: [
      { label: "Fed", id: null },
      { label: "CPI", id: null },
      { label: "Jobs", id: null },
    ],
  },
  {
    name: "Culture",
    accent: "orange",
    subs: [
      { label: "Awards", id: null },
      { label: "Box office", id: null },
      { label: "Music", id: null },
    ],
  },
  {
    name: "Tech",
    accent: "magenta",
    subs: [
      { label: "AI", id: null },
      { label: "Launches", id: null },
      { label: "Space", id: null },
    ],
  },
];
export const SOON_BEATS: readonly string[] = BEATS.filter((b) => b.name !== "Sports").map(
  (b) => b.name,
);

export interface AgentDraft {
  name: string;
  handle: string;
  venues: VenueOnMap[];
  beat: string;
  subcategories: string[];
  sites: string[];
  skills: string[];
  edge: string;
  style: Style;
  accent: Accent;
}

/** What the model must answer. The adapter validates against this shape's schema in api-schema. */
export interface AgentDrafter {
  draft(line: string): Promise<AgentDraft>;
}

/** Suggested skills by beat; the names the model may pick from and the form shows as cards. */
export const SUGGESTED_SKILLS: Record<string, { name: string; prompt: string }[]> = {
  Sports: [
    { name: "Injury double-check", prompt: "Only count an injury if two sources confirm it." },
    {
      name: "Weather at kickoff",
      prompt:
        "Check the stadium forecast. Wind over 15 mph lowers the chance of a high-scoring game.",
    },
    {
      name: "Late line moves",
      prompt: "If the line moved more than 2 points in 24 hours, find out why before calling.",
    },
  ],
  other: [
    { name: "Two sources rule", prompt: "Never call on a single source. Find a second one first." },
  ],
};

/** Every reason the draft cannot run today, as `venue:<x>` / `beat:<x>`. Empty means it can. */
export function unsupported(draft: AgentDraft): string[] {
  const reasons: string[] = [];
  for (const venue of draft.venues) {
    if (SOON_VENUES.includes(venue)) {
      reasons.push(`venue:${venue}`);
    }
  }
  if (SOON_BEATS.includes(draft.beat)) {
    reasons.push(`beat:${draft.beat}`);
  }
  return reasons;
}

/** A supported draft onto the config the runtime reads. Throws on anything `unsupported` would list. */
export function draftToConfig(draft: AgentDraft): AgentConfig {
  const problems = unsupported(draft);
  if (problems.length) {
    throw new Error(`Draft cannot run yet: ${problems.join(", ")}`);
  }
  const beat = BEATS.find((b) => b.name === draft.beat);
  if (!beat) {
    throw new Error(`Unknown beat ${draft.beat}`);
  }
  const subcategories = draft.subcategories.map((label) => {
    const sub = beat.subs.find((s) => s.label === label);
    if (!sub?.id) {
      throw new Error(`Unknown subcategory ${label}`);
    }
    return sub.id;
  });
  const suggested = SUGGESTED_SKILLS[draft.beat] ?? SUGGESTED_SKILLS.other!;
  const skills = draft.skills.flatMap((name) => {
    const s = suggested.find((k) => k.name === name);
    return s ? [s] : [];
  });
  // The draft always turns the web on; the form can turn it off (Task 10). Sites only decide the mode.
  const tools: ToolName[] = [...DEFAULT_CONFIG.tools];
  return {
    ...DEFAULT_CONFIG,
    tools,
    profile: draft.edge,
    marketScope: { version: 1, category: "sports", subcategories },
    sources: {
      web: { mode: draft.sites.length ? "prefer" : "anywhere", sites: draft.sites },
      books: [],
    },
    skills,
    uncertaintyPolicy: policyForStyle(draft.style),
    intervalHours: 6,
  };
}
```

Export from `packages/core/src/index.ts`. `SPORT_IDS` / `SportId` are exported from `market-scope.ts:5–6` with exactly `soccer`, `american-football`, `basketball`, `tennis` (verified).

- [ ] **Step 4: The api-schema schema**

```ts
// packages/api-schema/src/studio.ts
export const agentDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    venues: z.array(z.enum(["polymarket", "perpl"])).min(1),
    beat: z.enum(["Sports", "Crypto", "Politics", "Economics", "Culture", "Tech"]),
    subcategories: z.array(z.string().max(40)).max(6),
    sites: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20),
    skills: z.array(z.string().max(40)).max(8),
    edge: z.string().trim().min(1).max(400),
    style: z.enum(STYLES),
    accent: z.enum(ACCENTS),
  })
  .strict();
export type AgentDraftDto = z.infer<typeof agentDraftSchema>;
export const draftRequestSchema = z.object({ line: z.string().trim().min(3).max(280) }).strict();
```

- [ ] **Step 5: The adapter, with a failing test first**

```ts
// packages/infrastructure/test/openai-compatible-drafter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOpenAiCompatibleDrafter,
  DraftUnavailableError,
} from "../src/model/openai-compatible-drafter.js";

const answer = {
  name: "Halftime",
  handle: "halftime",
  venues: ["polymarket"],
  beat: "Sports",
  subcategories: ["NFL"],
  sites: ["espn.com"],
  skills: ["Injury double-check"],
  edge: "Reads injury reports first.",
  style: "balanced",
  accent: "lime",
};

test("asks the model in JSON mode and returns the validated draft", async () => {
  let seen: { url: string; body: unknown } | null = null;
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://model.example/v1",
    apiKey: "k",
    modelId: "m",
    fetch: async (url, init) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
        { status: 200 },
      );
    },
    validate: (raw) => raw as typeof answer,
  });
  const draft = await drafter.draft("Calls NFL games off injury news.");
  assert.equal(draft.handle, "halftime");
  assert.equal(seen?.url, "https://model.example/v1/chat/completions");
  assert.deepEqual((seen?.body as { response_format: unknown }).response_format, {
    type: "json_object",
  });
});

test("a model failure is DraftUnavailableError, never a guess", async () => {
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://model.example/v1",
    apiKey: "k",
    modelId: "m",
    fetch: async () => new Response("nope", { status: 500 }),
    validate: (raw) => raw as never,
  });
  await assert.rejects(() => drafter.draft("x"), DraftUnavailableError);
});

test("an answer the validator refuses is also unavailable", async () => {
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://model.example/v1",
    apiKey: "k",
    modelId: "m",
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })),
    validate: () => {
      throw new Error("bad");
    },
  });
  await assert.rejects(() => drafter.draft("x"), DraftUnavailableError);
});
```

```ts
// packages/infrastructure/src/model/openai-compatible-drafter.ts
import type { AgentDraft, AgentDrafter } from "@pickler/core";

export class DraftUnavailableError extends Error {
  readonly code = "DRAFT_UNAVAILABLE";
  constructor(cause: string) {
    super(`The model could not draft the agent: ${cause}`);
  }
}

export interface DrafterConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  fetch?: typeof fetch;
  /** api-schema's parser, injected by the worker so this package imports neither zod schemas nor core rules twice. */
  validate: (raw: unknown) => AgentDraft;
}

const SYSTEM = `You set up a trading agent for a person from one sentence. Answer with one JSON object and nothing else, with exactly these keys:
name (≤40 chars), handle (3–15 chars, [a-z0-9_]), venues (array of "polymarket" and/or "perpl"),
beat (one of Sports, Crypto, Politics, Economics, Culture, Tech), subcategories (labels for that beat, e.g. NFL, NBA, Soccer, Tennis, Bitcoin, Fed),
sites (bare hostnames worth reading, up to 6), skills (names from: Injury double-check, Weather at kickoff, Late line moves, Two sources rule),
edge (one sentence, the person's line rewritten as what the agent looks for), style (careful|balanced|bold), accent (lime|cyan|amber|orange|magenta|violet|blue).`;

export function createOpenAiCompatibleDrafter(config: DrafterConfig): AgentDrafter {
  const call = config.fetch ?? fetch;
  return {
    async draft(line) {
      let response: Response;
      try {
        response = await call(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model: config.modelId,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: line },
            ],
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (caught) {
        throw new DraftUnavailableError(caught instanceof Error ? caught.message : String(caught));
      }
      if (!response.ok) {
        throw new DraftUnavailableError(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new DraftUnavailableError("empty answer");
      }
      try {
        return config.validate(JSON.parse(content));
      } catch (caught) {
        throw new DraftUnavailableError(
          caught instanceof Error ? caught.message : "invalid answer",
        );
      }
    },
  };
}
```

Export from `packages/infrastructure/src/index.ts`.

- [ ] **Step 6: The route**

`workers/api/src/env.ts`: add `MODEL_BASE_URL?: string; MODEL_ID?: string; MODEL_API_KEY?: string;`. `.dev.vars.example`: the three names with a comment "the same model the research worker uses; the studio drafts an agent from one line with it". `container.ts`:

```ts
const drafter =
  env.MODEL_BASE_URL && env.MODEL_ID && env.MODEL_API_KEY
    ? createOpenAiCompatibleDrafter({
        baseUrl: env.MODEL_BASE_URL,
        apiKey: env.MODEL_API_KEY,
        modelId: env.MODEL_ID,
        validate: (raw) => agentDraftSchema.parse(raw),
      })
    : null;
```

passed into the studio services as `drafter`. In `routes/studio.ts`:

```ts
api.post("/agents/draft", async (c) => {
  await access.authorize(c.get("principal"));
  if (!services.drafter) {
    throw new PilotError("DRAFT_UNAVAILABLE", "No model is configured for drafting");
  }
  const { line } = draftRequestSchema.parse(await c.req.json());
  try {
    const draft = await services.drafter.draft(line);
    return c.json({ draft, unsupported: unsupported(draft) });
  } catch (caught) {
    if (caught instanceof DraftUnavailableError) {
      throw new PilotError("DRAFT_UNAVAILABLE", caught.message);
    }
    throw caught;
  }
});
```

Add `DRAFT_UNAVAILABLE` to `PilotError`'s code union and to the error-handler's status map as **503** (read `workers/api/src/http/error-handler.ts` for the map). Route test in `workers/api/test/studio-draft-route.test.ts`: with a stub drafter returning the fixture → 200 with `unsupported: []`; with a stub that throws `DraftUnavailableError` → 503 body code `DRAFT_UNAVAILABLE`; with no drafter → 503; with a draft naming `perpl` → 200 and `unsupported: ["venue:perpl"]`.

- [ ] **Step 7: Gates, commit**

```bash
git commit -m "Draft an agent from one line with the runtime's model, and say what cannot run yet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core packages/api-schema packages/infrastructure workers/api
```

---

## Task 4: The runtime honours `sources` and `skills`

**Files:**

- Modify: `packages/agent-runtime/src/plugins/exa.ts` (find it: `grep -rln "exa" packages/agent-runtime/src/plugins`), the prompt builder that reads `config.profile` (`grep -rn "config.profile" packages/agent-runtime/src`), the odds plugin (`grep -rln "the-odds-api" packages/agent-runtime/src/plugins`)
- Test: `packages/agent-runtime/test/exa-allow-list.test.ts`, extend the prompt test file

- [ ] **Step 1: Failing tests**

```ts
// packages/agent-runtime/test/exa-allow-list.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedHost, exaSearchBody } from "../src/plugins/exa.js";

test("only mode refuses a host outside the list, prefer and anywhere do not", () => {
  const sites = ["espn.com", "nfl.com"];
  assert.equal(allowedHost("https://www.espn.com/nfl/story", { mode: "only", sites }), true);
  assert.equal(allowedHost("https://reddit.com/r/nfl", { mode: "only", sites }), false);
  assert.equal(allowedHost("https://reddit.com/r/nfl", { mode: "prefer", sites }), true);
  assert.equal(allowedHost("https://reddit.com/r/nfl", { mode: "anywhere", sites: [] }), true);
});

test("the search request carries the list as includeDomains for only and prefer, and nothing for anywhere", () => {
  const sites = ["espn.com"];
  assert.deepEqual(exaSearchBody("q", { mode: "only", sites }).includeDomains, sites);
  assert.deepEqual(exaSearchBody("q", { mode: "prefer", sites }).includeDomains, sites);
  assert.equal(exaSearchBody("q", { mode: "anywhere", sites: [] }).includeDomains, undefined);
});
```

Prompt test: `composeBrief(config.profile, config.skills ?? [])` is what reaches the system prompt — assert the rendered prompt contains "Rules it follows:" when a skill is configured and not otherwise.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — in the Exa plugin, export two pure helpers and use them:

```ts
export function allowedHost(url: string, web: { mode: WebMode; sites: string[] }): boolean {
  if (web.mode !== "only") {
    return true;
  }
  const host = new URL(url).hostname.replace(/^www\./, "");
  return web.sites.some((site) => host === site || host.endsWith(`.${site}`));
}
export function exaSearchBody(query: string, web: { mode: WebMode; sites: string[] }) {
  return {
    query,
    numResults: 5,
    ...(web.mode === "anywhere" ? {} : { includeDomains: web.sites }),
  };
}
```

`readPage` throws `PilotError("INVALID_INPUT", "Outside the agent's site list")` when `!allowedHost(url, web)`; the `prefer` fallback is: if `includeDomains` returned zero results, search again without it (one retry, logged as an event `sources.fallback`). The odds plugin filters providers by `config.sources?.books` when non-empty. The prompt builder replaces `config.profile` with `composeBrief(config.profile, config.skills ?? [])`. Read `apps/agent-service/AGENTS.md` and `packages/agent-runtime/AGENTS.md` first; update them with the two new config fields.

- [ ] **Step 4: Pass; mutate** — make `allowedHost` return `true` always → first test reddens; revert.

- [ ] **Step 5: Commit**

```bash
git commit -m "Read only where the person said, and follow the rules they wrote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/agent-runtime
```

---

## Task 5: Tables for the agent's wallet, its deposits, and the delegated user

**Files:**

- Modify: `packages/infrastructure/src/persistence/product/wallets.ts`
- Create: generated migration under `packages/infrastructure/drizzle/`

- [ ] **Step 1: Schema**

In `turnkeyOrgs`, after `rootUserId`:

```ts
      /** Pickler's non-root user inside this person's sub-organization; set in the first agent's ceremony. */
      delegatedUserId: text("delegated_user_id"),
```

New tables after `walletAccounts`:

```ts
/** One wallet per agent, linked only once its policies were approved. */
export const agentWallets = wallets
  .table(
    "agent_wallets",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id, { onDelete: "cascade" }),
      walletId: text("wallet_id")
        .notNull()
        .references(() => walletRecords.walletId),
      /** Turnkey policy ids the person approved for this wallet, in the order created. */
      policyIds: text("policy_ids").array().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("agent_wallets_wallet_key").on(t.walletId),
      check("agent_wallets_policies", sql`cardinality(${t.policyIds}) >= 2`),
    ],
  )
  .enableRLS();

/** What the person sent from the master wallet to an agent's. The chain is the truth; this is the receipt. */
export const deposits = wallets
  .table(
    "deposits",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
      txHash: text("tx_hash").notNull(),
      amountMicroUsd: bigint("amount_micro_usd", { mode: "bigint" }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("deposits_tx_key").on(t.txHash),
      index("deposits_agent_idx").on(t.agentId),
      check("deposits_tx_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();
```

(`agents` imported from `./agents.js`; check the import style the file already uses for cross-schema references — `market.ts` references `agents.id` the same way.)

- [ ] **Step 2: Generate, read, apply** — `cd packages/infrastructure && npx drizzle-kit generate`; the SQL must contain one `ALTER TABLE "wallets"."turnkey_orgs" ADD COLUMN`, two `CREATE TABLE`, and nothing else; `npm run db:migrate`; `node --import tsx --test packages/infrastructure/test/custody-store.test.ts; echo "exit=$?"` → 0.

- [ ] **Step 3: Commit**

```bash
git commit -m "Give an agent a wallet of its own, a receipt for every deposit, and Pickler a seat with no rights

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/infrastructure/src/persistence/product/wallets.ts packages/infrastructure/drizzle
```

---

## Task 6: The ceremony — delegated user, agent wallet, approved policies

**Files:**

- Create: `packages/core/src/features/wallets/domain/agent-wallet-policies.ts`
- Create: `packages/infrastructure/src/turnkey/turnkey-activities.ts`
- Modify: `packages/core/src/features/wallets/application/custody.ts`, `packages/core/src/features/wallets/ports/*.ts` (repository + builders)
- Modify: `packages/infrastructure/src/persistence/custody-store.ts`
- Modify: `workers/api/src/routes/signing.ts`, `workers/api/src/container.ts`
- Test: `packages/core/test/agent-wallet-policies.test.ts`, `packages/core/test/custody-agent-wallet.test.ts`, `packages/infrastructure/test/custody-store.test.ts` (extend), `workers/api/test/signing-agents.test.ts`

- [ ] **Step 1: The policies, pure, with a failing test**

```ts
// packages/core/test/agent-wallet-policies.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentWalletPolicies } from "../src/features/wallets/domain/agent-wallet-policies.js";

test("three policies when the venue list is non-empty, two when it is empty", () => {
  const withVenue = agentWalletPolicies({
    delegatedUserId: "da",
    walletId: "w1",
    venueContracts: ["0x1111111111111111111111111111111111111111"],
  });
  assert.equal(withVenue.length, 3);
  const none = agentWalletPolicies({ delegatedUserId: "da", walletId: "w1", venueContracts: [] });
  assert.equal(none.length, 2);
  assert.ok(none.every((p) => p.effect === "EFFECT_DENY"));
});

test("the allow policy names the wallet and every venue address, and the deny names both selectors", () => {
  const [allow, deny, guard] = agentWalletPolicies({
    delegatedUserId: "da",
    walletId: "w1",
    venueContracts: ["0xaaaa", "0xbbbb"],
  });
  assert.match(allow!.condition, /wallet\.id == 'w1'/);
  assert.match(allow!.condition, /eth\.tx\.to == '0xaaaa' \|\| eth\.tx\.to == '0xbbbb'/);
  assert.equal(allow!.consensus, "approvers.any(user, user.id == 'da')");
  assert.match(deny!.condition, /0xa9059cbb/);
  assert.match(deny!.condition, /0x095ea7b3/);
  assert.equal(guard!.effect, "EFFECT_DENY");
  assert.match(guard!.condition, /activity\.resource == 'POLICY'/);
});
```

```ts
// packages/core/src/features/wallets/domain/agent-wallet-policies.ts
export interface TurnkeyPolicy {
  policyName: string;
  effect: "EFFECT_ALLOW" | "EFFECT_DENY";
  consensus: string;
  condition: string;
  notes: string;
}

const TRANSFER = "0xa9059cbb";
const APPROVE = "0x095ea7b3";

/**
 * The rules a person approves for one agent wallet. The subject is Pickler's delegated user; the
 * root (the passkey) is not bound by policies, which is what lets the master recover funds.
 * Order matters in Turnkey (first match wins, DENY beats ALLOW), so the guard goes last here and
 * first in `order` when created.
 */
export function agentWalletPolicies(input: {
  delegatedUserId: string;
  walletId: string;
  venueContracts: readonly string[];
}): TurnkeyPolicy[] {
  const consensus = `approvers.any(user, user.id == '${input.delegatedUserId}')`;
  const policies: TurnkeyPolicy[] = [];
  if (input.venueContracts.length > 0) {
    const to = input.venueContracts.map((a) => `eth.tx.to == '${a}'`).join(" || ");
    policies.push({
      policyName: `Trade only, from ${input.walletId}, to the venue`,
      effect: "EFFECT_ALLOW",
      consensus,
      condition: `activity.action == 'SIGN' && wallet.id == '${input.walletId}' && (${to})`,
      notes:
        "Pickler's delegated user may sign transactions from this wallet only to the listed venue contracts.",
    });
  }
  policies.push({
    policyName: `Never a transfer out of ${input.walletId}`,
    effect: "EFFECT_DENY",
    consensus,
    condition: `wallet.id == '${input.walletId}' && (eth.tx.data[0..10] == '${TRANSFER}' || eth.tx.data[0..10] == '${APPROVE}')`,
    notes: "The agent never withdraws: no ERC-20 transfer or approve, whatever else is allowed.",
  });
  policies.push({
    policyName: "Only root changes the rules",
    effect: "EFFECT_DENY",
    consensus,
    condition: "activity.resource == 'POLICY'",
    notes: "The delegated user may not create, update or delete policies.",
  });
  return policies;
}
```

Also export `DELEGATED_USER_SELF_DELETE(delegatedUserId)` returning the self-delete ALLOW policy from Turnkey's guidance (`activity.type == 'ACTIVITY_TYPE_DELETE_USERS' && activity.params.user_ids.count() == 1 && '<id>' in activity.params.user_ids`).

- [ ] **Step 2: Unsigned activity builders (infrastructure)**

```ts
// packages/infrastructure/src/turnkey/turnkey-activities.ts
import type { TurnkeyApiTypes } from "@turnkey/http";
import type { TurnkeyPolicy, UnsignedActivity } from "@pickler/core";
import { TURNKEY_API_BASE_URL } from "./turnkey-transport.js";
import { MONAD_ACCOUNT } from "./turnkey-sub-organization.js";

const now = () => String(Date.now());

/** Bodies the browser stamps with the passkey. None is stamped here: the parent key is not a voter inside a sub-organization. */
export function createActivityBuilders(config: { baseUrl?: string } = {}) {
  const base = config.baseUrl ?? TURNKEY_API_BASE_URL;
  const unsigned = (path: string, organizationId: string, request: object): UnsignedActivity => ({
    url: `${base}/public/v1/submit/${path}`,
    body: JSON.stringify(request),
    timestampMs: (request as { timestampMs: string }).timestampMs,
    organizationId,
  });
  return {
    createDelegatedUser(input: { subOrganizationId: string; publicKey: string }): UnsignedActivity {
      const request: TurnkeyApiTypes["v1CreateUsersRequest"] = {
        type: "ACTIVITY_TYPE_CREATE_USERS_V3",
        timestampMs: now(),
        organizationId: input.subOrganizationId,
        parameters: {
          users: [
            {
              userName: "Pickler",
              apiKeys: [
                {
                  apiKeyName: "pickler-delegated",
                  publicKey: input.publicKey,
                  curveType: "API_KEY_CURVE_P256",
                },
              ],
              authenticators: [],
              oauthProviders: [],
              userTags: [],
            },
          ],
        },
      };
      return unsigned("create_users", input.subOrganizationId, request);
    },
    createAgentWallet(input: { subOrganizationId: string; handle: string }): UnsignedActivity {
      const request: TurnkeyApiTypes["v1CreateWalletRequest"] = {
        type: "ACTIVITY_TYPE_CREATE_WALLET",
        timestampMs: now(),
        organizationId: input.subOrganizationId,
        parameters: { walletName: input.handle, accounts: [MONAD_ACCOUNT] },
      };
      return unsigned("create_wallet", input.subOrganizationId, request);
    },
    createPolicies(input: {
      subOrganizationId: string;
      policies: TurnkeyPolicy[];
    }): UnsignedActivity {
      const request: TurnkeyApiTypes["v1CreatePoliciesRequest"] = {
        type: "ACTIVITY_TYPE_CREATE_POLICIES",
        timestampMs: now(),
        organizationId: input.subOrganizationId,
        parameters: {
          policies: input.policies.map((p) => ({
            policyName: p.policyName,
            effect: p.effect,
            consensus: p.consensus,
            condition: p.condition,
            notes: p.notes,
          })),
        },
      };
      return unsigned("create_policies", input.subOrganizationId, request);
    },
    signTransaction(input: {
      subOrganizationId: string;
      signWith: string;
      unsignedTransaction: string;
    }): UnsignedActivity {
      const request: TurnkeyApiTypes["v1SignTransactionRequest"] = {
        type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
        timestampMs: now(),
        organizationId: input.subOrganizationId,
        parameters: {
          signWith: input.signWith,
          unsignedTransaction: input.unsignedTransaction,
          type: "TRANSACTION_TYPE_ETHEREUM",
        },
      };
      return unsigned("sign_transaction", input.subOrganizationId, request);
    },
  };
}
```

If a `TurnkeyApiTypes` key differs in the vendored version, `typecheck` says so — fix the name, not the shape. The CREATE_POLICIES result carries `policyIds: string[]`; CREATE_WALLET's carries `walletId` and `addresses[]`; CREATE_USERS' carries `userIds[]` — read them off the forwarded activity's `result` the way `confirmAddPasskey` reads its result.

- [ ] **Step 3: The custody service, prepare/confirm per step, with failing tests first**

Add to `custody.ts` (deps gain `builders` from Step 2 and `venueContracts: readonly string[]`, today `[]`):

```ts
    prepareDelegatedUser(userId) → { unsigned } (throws if the org already has delegated_user_id)
    confirmDelegatedUser(userId, signed) → forwards with allowedActivityTypes ["ACTIVITY_TYPE_CREATE_USERS_V3"], reads userIds[0], repository.saveDelegatedUser(userId, id), then prepares nothing — the self-delete policy is included in the first agent's createPolicies batch
    prepareAgentWallet(userId, handle) → { unsigned } (throws WalletExistsError if an orphan wallet named `handle` exists — see confirm)
    confirmAgentWallet(userId, handle, signed) → forwards ["ACTIVITY_TYPE_CREATE_WALLET"], reads walletId + address, repository.saveWallet({ kind: "agent", name: handle, ... }), returns { walletId, address }
    preparePolicies(userId, walletId) → agentWalletPolicies({ delegatedUserId, walletId, venueContracts }) (+ self-delete on the first agent) → { unsigned, policies }
    confirmPolicies(userId, walletId, signed) → forwards ["ACTIVITY_TYPE_CREATE_POLICIES"], reads policyIds, returns { policyIds } (the link row is written by the studio's create-agent transaction, Task 7, which receives walletId + policyIds)
    findOrphanWallet(userId, handle) → a kind:'agent' wallet named handle with no agent_wallets row, or null
```

Tests in `packages/core/test/custody-agent-wallet.test.ts` with fake deps (the file `custody.test.ts` shows how `deps.turnkey`, `deps.repository`, `deps.forwarder` are faked): the forwarder is called with the right `allowedActivityTypes`; `confirmAgentWallet` saves `kind: "agent"`; `preparePolicies` includes the self-delete policy only when `delegated_user_id` was set in this ceremony (pass a flag `firstAgent`); `prepareDelegatedUser` throws when one exists.

- [ ] **Step 4: Store methods with DB tests** — in `custody-store.ts`: `saveDelegatedUser(userId, delegatedUserId)`, `saveWallet(input)` (insert `wallets.wallets` + `wallet_accounts`), `findOrphanWallet(userId, name)` (LEFT JOIN `agent_wallets` … `WHERE aw.agent_id IS NULL AND w.kind='agent' AND w.name=$2`), `findAgentWallet(agentId)` (JOIN `agent_wallets` → `wallets` → `wallet_accounts`, returns `{ walletId, address } | null`; Task 8 reads it), `saveDeposit(input)`. Tests in `custody-store.test.ts`: an agent wallet without a link is an orphan; once `agent_wallets` has the row it is not; two links to one wallet are refused.

- [ ] **Step 5: Routes** — under `/v1/signing/agents`: `POST /delegated/prepare`, `POST /delegated/confirm`, `POST /wallet/prepare {handle}`, `POST /wallet/confirm {handle, signed}`, `POST /wallet/:walletId/policies/prepare`, `POST /wallet/:walletId/policies/confirm {signed}`, each using `person(c)`, `jsonBody`, `signedActivity(body)` exactly as `/passkeys/add/*` do, answering `successEnvelope`. Route test: each prepare returns `{url, body, timestampMs, organizationId}` and each confirm forwards to a fake forwarder and returns the ids.

- [ ] **Step 6: Gates, commit**

```bash
git commit -m "Let a person give an agent a wallet and approve its rules with one passkey

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core packages/infrastructure/src packages/infrastructure/test workers/api
```

---

## Task 7: Creating the agent links the wallet, and a retry finds an orphan

**Files:**

- Modify: `packages/api-schema/src/studio.ts` (`createAgentSchema` gains `wallet: { walletId, policyIds }`)
- Modify: `packages/core/src/features/studio/access.ts` (input type)
- Modify: `packages/infrastructure/src/studio/directory.ts` (the transaction)
- Test: `packages/infrastructure/test/studio.test.ts`

- [ ] **Step 1: Failing tests**

```ts
test("creating an agent links the wallet whose policies were approved", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  await enableResearch(store, userId);
  await seedAgentWallet(store.pool, userId, { walletId: "w1", name: "halftime" }); // helper: wallets.wallets kind agent + account
  const { agentId } = await directory.createAgent(access, userId, {
    ...input,
    handle: "halftime",
    key: "k",
    wallet: { walletId: "w1", policyIds: ["p1", "p2"] },
  });
  const { rows } = await store.pool.query(
    `SELECT wallet_id, policy_ids FROM wallets.agent_wallets WHERE agent_id=$1`,
    [agentId],
  );
  assert.deepEqual(rows[0], { wallet_id: "w1", policy_ids: ["p1", "p2"] });
});

test("a wallet already linked to another agent is refused, and no agent row survives", async (t) => {
  /* second createAgent with the same walletId → rejects; count agents = 1 */
});

test("without a wallet the request is refused", async (t) => {
  /* zod: wallet required */
});
```

- [ ] **Step 2: Implement** — `createAgentSchema` adds `wallet: z.object({ walletId: z.string().min(1), policyIds: z.array(z.string()).min(2) }).strict()`. In `directory.ts`'s transaction, after `agent_profiles`: `INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1,$2,$3)`; a `23505` on `agent_wallets_wallet_key` maps to `CONFLICT` "That wallet already belongs to an agent" via the `CONFLICTS` table from marketplace Task 3. The idempotency JSON includes `wallet`.

- [ ] **Step 3: Pass; mutate** — move the insert outside the transaction → the second test's count assertion reddens; revert.

- [ ] **Step 4: Commit**

```bash
git commit -m "An agent is created with its wallet, or not at all

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/api-schema packages/core packages/infrastructure
```

---

## Task 8: Balance, locks, limits — and the DTO that carries them

**Files:**

- Create: `packages/core/src/features/studio/locks.ts`, `packages/infrastructure/src/chain/erc20.ts`
- Modify: `packages/api-schema/src/studio.ts` (`studioAgentSchema`), `workers/api/src/routes/studio.ts`, `workers/api/src/container.ts`, `workers/api/src/env.ts` (`MONAD_RPC_URL?`), `packages/chain/src/networks.ts` (nothing to add: `AUSD[10143]` and `MONAD_TESTNET.publicRpcUrls` exist)
- Test: `packages/core/test/locks.test.ts`, `packages/infrastructure/test/erc20.test.ts`, extend `workers/api/test/studio-route.test.ts`

- [ ] **Step 1: Locks, pure, failing tests**

```ts
// packages/core/test/locks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_FUNDED_AUSD, canCreateAnother, canSchedule } from "../src/features/studio/locks.js";

test("the schedule needs one successful run and ten AUSD", () => {
  assert.deepEqual(canSchedule({ ready: false, balanceAusd: 50 }), {
    ok: false,
    reason: "first_run",
  });
  assert.deepEqual(canSchedule({ ready: true, balanceAusd: 9.99 }), {
    ok: false,
    reason: "unfunded",
  });
  assert.deepEqual(canSchedule({ ready: true, balanceAusd: MIN_FUNDED_AUSD }), {
    ok: true,
    reason: null,
  });
});

test("another agent needs every existing one funded", () => {
  assert.deepEqual(canCreateAnother([]), { ok: true, reason: null });
  assert.deepEqual(canCreateAnother([12, 40]), { ok: true, reason: null });
  assert.deepEqual(canCreateAnother([12, 3]), { ok: false, reason: "unfunded_agent" });
});
```

```ts
// packages/core/src/features/studio/locks.ts
export const MIN_FUNDED_AUSD = 10;
export type Lock =
  { ok: true; reason: null } | { ok: false; reason: "first_run" | "unfunded" | "unfunded_agent" };
/** `ready` is the runtime's NOT_READY cleared: one successful manual run with the current config. */
export function canSchedule(input: { ready: boolean; balanceAusd: number }): Lock {
  if (!input.ready) {
    return { ok: false, reason: "first_run" };
  }
  if (input.balanceAusd < MIN_FUNDED_AUSD) {
    return { ok: false, reason: "unfunded" };
  }
  return { ok: true, reason: null };
}
/** One unfunded agent at a time. */
export function canCreateAnother(balancesAusd: readonly number[]): Lock {
  return balancesAusd.every((b) => b >= MIN_FUNDED_AUSD)
    ? { ok: true, reason: null }
    : { ok: false, reason: "unfunded_agent" };
}
```

- [ ] **Step 2: ERC-20 over JSON-RPC, failing tests with a fake fetch**

```ts
// packages/infrastructure/src/chain/erc20.ts
export interface Rpc {
  call(method: string, params: unknown[]): Promise<unknown>;
}
export function createJsonRpc(url: string, call: typeof fetch = fetch): Rpc {
  /* POST {jsonrpc:"2.0",id:1,method,params}; throws on `error` or non-ok */
}
const BALANCE_OF = "0x70a08231";
const TRANSFER = "0xa9059cbb";
const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
export async function erc20Balance(rpc: Rpc, token: string, owner: string): Promise<bigint> {
  const data = BALANCE_OF + pad(owner);
  const result = (await rpc.call("eth_call", [{ to: token, data }, "latest"])) as string;
  return BigInt(result);
}
export function transferCalldata(to: string, amount: bigint): string {
  return TRANSFER + pad(to) + amount.toString(16).padStart(64, "0");
}
/** A display figure from base units; 6 decimals for AUSD. Floors, never rounds up. */
export function toDisplay(units: bigint, decimals: number): number {
  const whole = units / 10n ** BigInt(decimals);
  const frac = units % 10n ** BigInt(decimals);
  return Number(whole) + Number(frac) / 10 ** decimals;
}
export function createBalanceReader(
  rpc: Rpc,
  token: string,
  decimals: number,
  ttlMs = 15_000,
  clock = Date.now,
) {
  const cache = new Map<string, { at: number; value: number }>();
  return {
    async read(address: string): Promise<number> {
      /* cached by address for ttlMs */
    },
    forget(address: string) {
      cache.delete(address.toLowerCase());
    },
  };
}
```

Tests: `erc20Balance` sends `eth_call` with the padded owner and parses the hex; `transferCalldata("0xabc…", 25_000_000n)` starts with `0xa9059cbb` and ends with `…17d7840`; `toDisplay(25_000_000n, 6) === 25`; the reader hits the RPC once per 15 s and again after `forget`.

- [ ] **Step 3: The DTO and the routes**
      `studioAgentSchema` gains:

```ts
  wallet: z.object({ address: z.string(), balanceAusd: z.number(), walletId: z.string() }).nullable(),
  canSchedule: lockSchema, canCreateAnother: lockSchema,
```

with `lockSchema = z.object({ ok: z.boolean(), reason: z.enum(["first_run","unfunded","unfunded_agent"]).nullable() })`. The `GET /agents/:id` and `GET /agents` handlers read the linked wallet (`custody.findAgentWallet(agentId)` → address), the balance (`balances.read(address)`), `ready` from the same predicate that raises `NOT_READY` in `packages/core/src/features/research/policy.ts:27` — export it as `isReadyToSchedule(record)` if it is not already a function, and call it from both places, and compute both locks. `PUT /agents/:id/schedule` refuses with `PilotError("NOT_FUNDED")` when `canSchedule` says `unfunded`. `POST /agents` refuses with `PilotError("UNFUNDED_AGENT")` when `canCreateAnother` says so (skip when the person has no agents). New `PUT /agents/:id/limits { perCallAusd, perDayAusd }` → `ledger.configure({ trade: microUsd(perCall) , daily: microUsd(perDay) })` — read `BudgetCategory` in `ledger.ts` for the real category names and map the two the canvas shows. `MONAD_RPC_URL` env defaults to `MONAD_TESTNET.publicRpcUrls[0]`.

Route tests: with a fake balance reader returning 3, the agent DTO says `canSchedule: {ok:false, reason:"unfunded"}` and `PUT /schedule` → 409 `NOT_FUNDED`; with 10 and `ready` → ok.

- [ ] **Step 4: Gates, commit**

```bash
git commit -m "Read what an agent holds, and say plainly why it cannot run alone yet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core packages/infrastructure packages/api-schema workers/api
```

---

## Task 9: Deposit — build, sign with the passkey, broadcast, record

**Files:**

- Modify: `packages/core/src/features/wallets/application/custody.ts` (`prepareDeposit`, `confirmDeposit`), `packages/infrastructure/src/chain/erc20.ts` (nonce, gas, raw tx encoding), `workers/api/src/routes/studio.ts`
- Test: `packages/infrastructure/test/erc20-tx.test.ts`, `workers/api/test/studio-deposit.test.ts`

- [ ] **Step 1: The unsigned transaction** — Turnkey's `SIGN_TRANSACTION_V2` takes an RLP-encoded unsigned EIP-1559 transaction as hex. Encode it by hand in `erc20.ts` (no ethers/viem in infrastructure today; check `grep -n "viem\|ethers" packages/infrastructure/package.json` — if viem is already a dependency of the repo root, use `viem/utils` `serializeTransaction`; otherwise write a minimal RLP encoder for `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList]` with the `0x02` type prefix, with a test vector). `prepareDeposit(userId, agentId, amountAusd)`: master address from `turnkey_orgs` → `wallet_accounts`; agent address from `agent_wallets`; `nonce = eth_getTransactionCount(master, "pending")`; `maxFeePerGas`/priority from `eth_gasPrice` ×2 / 1 gwei; `gasLimit 80_000`; `data = transferCalldata(agent, amount × 10^6)`; returns `{ unsigned: builders.signTransaction({ subOrganizationId, signWith: masterAddress, unsignedTransaction }), amountMicroUsd }`.

- [ ] **Step 2: Confirm and broadcast** — `confirmDeposit(userId, agentId, signed)`: forwards with `["ACTIVITY_TYPE_SIGN_TRANSACTION_V2"]`, reads `signedTransaction` from the result, `eth_sendRawTransaction`, `saveDeposit({ agentId, txHash, amountMicroUsd })`, `balances.forget(agentAddress)`; return `{ txHash }`. The home's strip reads `wallets.deposits`; no run event is written.

- [ ] **Step 3: Routes** — `POST /v1/studio/agents/:id/deposit/prepare { amountAusd ∈ {10,25,50,100} }` and `POST /v1/studio/agents/:id/deposit/confirm { signed }`. Tests with a fake RPC (records `eth_sendRawTransaction`), fake forwarder returning a signed tx, and the DB: after confirm, `wallets.deposits` has the row and a second confirm with the same hash is refused (unique).

- [ ] **Step 4: Commit**

```bash
git commit -m "Move AUSD from the master wallet to an agent's, signed by the passkey and recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core packages/infrastructure workers/api
```

---

## Task 10: Web — the pure half of creation

**Files:**

- Create: `apps/web/src/features/studio/create/draft.ts` (replaces `empty/draft.ts` — `git rm` the old one and `empty/create-flow.tsx`, `empty/draft-overview.tsx` in Task 11)
- Modify: `apps/web/src/features/studio/api.ts` (`studioApi` calls: `draft`, `signing.agents.*`, `deposit.*`, `limits`)
- Test: `apps/web/test/studio-create-draft.test.ts`

- [ ] **Step 1: Failing tests** — port the canvas's `ok(step)` and the review text builders:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER,
  emptyDraft,
  ready,
  reviewRows,
  soonRows,
  fromApiDraft,
} from "../src/features/studio/create/draft.js";

test("each step is ready exactly when the canvas says", () => {
  const d = emptyDraft();
  assert.equal(ready("start", d), false);
  assert.equal(ready("start", { ...d, prompt: "Calls NFL games." }), true);
  assert.equal(ready("name", { ...d, name: "Halftime", handle: "ha" }), false);
  assert.equal(
    ready("name", { ...d, name: "Halftime", handle: "halftime", handleAvailable: true }),
    true,
  );
  assert.equal(ready("trades", { ...d, venues: [] }), false);
  assert.equal(
    ready("looks", { ...d, venues: ["polymarket"], beat: "Sports", subs: ["NFL"] }),
    true,
  );
  assert.equal(ready("reads", { ...d, webOn: true, webMode: "only", sites: [] }), false);
  assert.equal(ready("decides", { ...d, edge: "" }), false);
});

test("a Soon choice shows up as a review row that blocks creation", () => {
  const rows = soonRows({ ...emptyDraft(), venues: ["polymarket", "perpl"], beat: "Economics" });
  assert.deepEqual(
    rows.map((r) => r.label),
    ["TRADES ON", "CALLS"],
  );
});

test("the api draft lands in the form with the sites in prefer mode", () => {
  const d = fromApiDraft({
    name: "Halftime",
    handle: "halftime",
    venues: ["polymarket"],
    beat: "Sports",
    subcategories: ["NFL"],
    sites: ["espn.com"],
    skills: ["Injury double-check"],
    edge: "E",
    style: "balanced",
    accent: "lime",
  });
  assert.equal(d.webMode, "prefer");
  assert.deepEqual(d.sites, ["espn.com"]);
});
```

`ORDER = ["name","trades","looks","reads","skills","decides","review"]`; the `Draft` type holds `prompt, name, handle, handleAvailable, venues, beat, subs, perps, webOn, webMode, sites, pages, sportsOn, oddsOn, books, skills (names), custom ({name,prompt}[]), edge, style, accent, blurb, xHandle`. `reviewRows(d)` returns the six rows (`NAME, TRADES ON, CALLS, READS, SKILLS, DECIDES`) with the text builders from the canvas (`tradesText`, `callsText`, `readsText`, `skillsText`, `decidesText`). `toCreate(d, walletId, policyIds)` builds the `POST /agents` body: `config` from the same mapping as core's `draftToConfig` but expressed over the form's fields (web mode, books, custom skills included), plus `profile` (accent from the beat, blurb = edge, xHandle) and `wallet`. `SOON` lists mirror core's (`api-schema` exports them: add `SOON_VENUES`, `SOON_BEATS`, `BEATS` labels to `packages/api-schema/src/studio.ts` in Task 3 so the web never imports core).

- [ ] **Step 2: Implement, run, mutate** (make `ready("reads")` ignore `sites.length` → reddens), commit:

```bash
git commit -m "The creation form's rules, pure and tested

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- apps/web/src/features/studio/create/draft.ts apps/web/src/features/studio/api.ts apps/web/test/studio-create-draft.test.ts packages/api-schema/src/studio.ts
```

---

## Task 11: Web — the creation screens and the ceremony

**Files:**

- Create: `apps/web/src/features/studio/create/{create.tsx, describe.tsx, reading.tsx, steps/{name,trades,calls,reads,skills,decides}.tsx, review.tsx, first-run.tsx, ceremony.ts, stack.tsx}` and `create.module.css`
- Modify: `apps/web/src/app/studio/new/page.tsx` (create), `apps/web/src/features/studio/studio.tsx` (open `/studio/new` when there are no agents)
- Delete: `apps/web/src/features/studio/empty/{create-flow,draft-overview,draft}.tsx|ts`; keep `passkey-sheet.tsx`, `piece.tsx`, `empty-studio.tsx` only if `studio.tsx` still routes to it for the "no agents" preview — otherwise delete it too and point the preview at `/studio/new`
- Test: `apps/web/test/studio-ceremony.test.ts`

- [ ] **Step 1: The ceremony, pure sequencing with fakes**

```ts
// apps/web/src/features/studio/create/ceremony.ts
export type CeremonyStep = "register" | "delegated" | "wallet" | "policies" | "agent" | "run";
export interface CeremonyDeps {
  hasSubOrganization(): Promise<boolean>;
  register(): Promise<void>; // existing enrol flow (custody.ts) — sub-org + master
  hasDelegated(): Promise<boolean>;
  stamp(unsigned: UnsignedActivityDto): Promise<SignedActivityDto>; // webauthn-stamper
  api: {
    prepareDelegated(): Promise<UnsignedActivityDto>;
    confirmDelegated(s): Promise<void>;
    prepareWallet(handle): Promise<UnsignedActivityDto>;
    confirmWallet(handle, s): Promise<{ walletId: string; address: string }>;
    preparePolicies(walletId): Promise<UnsignedActivityDto>;
    confirmPolicies(walletId, s): Promise<{ policyIds: string[] }>;
    createAgent(body): Promise<Agent>;
    startRun(agentId): Promise<{ runId: string }>;
  };
  onStep(step: CeremonyStep, state: "start" | "done"): void;
}
export async function runCeremony(
  deps: CeremonyDeps,
  draft: Draft,
): Promise<{ agent: Agent; runId: string; address: string }> {
  if (!(await deps.hasSubOrganization())) {
    deps.onStep("register", "start");
    await deps.register();
    deps.onStep("register", "done");
  }
  if (!(await deps.hasDelegated())) {
    deps.onStep("delegated", "start");
    await deps.api.confirmDelegated(await deps.stamp(await deps.api.prepareDelegated()));
    deps.onStep("delegated", "done");
  }
  deps.onStep("wallet", "start");
  const wallet = await deps.api.confirmWallet(
    draft.handle,
    await deps.stamp(await deps.api.prepareWallet(draft.handle)),
  );
  deps.onStep("wallet", "done");
  deps.onStep("policies", "start");
  const { policyIds } = await deps.api.confirmPolicies(
    wallet.walletId,
    await deps.stamp(await deps.api.preparePolicies(wallet.walletId)),
  );
  deps.onStep("policies", "done");
  deps.onStep("agent", "start");
  const agent = await deps.api.createAgent(toCreate(draft, wallet.walletId, policyIds));
  deps.onStep("agent", "done");
  deps.onStep("run", "start");
  const { runId } = await deps.api.startRun(agent.id);
  return { agent, runId, address: wallet.address };
}
```

Test: with fakes, the steps fire in order; when `hasSubOrganization` is true, `register` is skipped; when `confirmPolicies` throws, `createAgent` is never called and the error propagates.

- [ ] **Step 2: Screens** — one component per canvas screen, all reading a single `useReducer` over `Draft` + `{ step, mode, editing, error }` in `create.tsx`; `?step=` in the URL mirrors `step` so the harness can open each. Copy, layout and ids straight from the canvas (`scratchpad/design/create-first-agent-v2.dc.html` is in the session scratchpad; the same file is in the design project as `Pickler Create First Agent v2.dc.html`):
  - `describe.tsx` `id="create-describe"`: textarea + three prompt chips + "Set it up from my line" (calls `POST /agents/draft`; on 503 shows "The model is busy. Build it step by step instead." and enables the manual path) + "Or build it step by step".
  - `reading.tsx` `id="create-reading"`: reveals `reviewRows` one per 620 ms, then goes to review.
  - the six step screens, each `id="create-<step>"`, with the progress rail (`piece.tsx`-style chips) only in manual mode; Soon options rendered disabled with a `SOON` chip.
  - `review.tsx` `id="create-review"`: the six rows, each with Edit; Soon rows flagged with the reason; the button "Create and run it once" disabled while `soonRows(d).length > 0`.
  - `first-run.tsx` `id="create-run"`: a four-line rail for the ceremony (Wallet · Rules · Agent · Run — "register" folds into Wallet on the first agent), then the run trace polled from `/runs/:id/events` every 1.5 s via `lib/polling.ts` until `/runs/:id` is terminal; "Waiting for a runner" after 20 s in `queued` with the command `npm run dev:research`; on `completed` with `decision.action === "TRADE"`, `POST /runs/:id/paper-order` once (idempotency key = runId); the pick card; "Open the studio" → `/studio`.
  - `stack.tsx`: the block stack on the right, from `reviewRows` + wallet + first call, as the canvas's `blocks`.
    The passkey stamping uses the existing `ceremony.ts` in `features/auth/lib` for `register` and `@turnkey/webauthn-stamper` for the three activities — read `features/auth/lib/webauthn.ts` for how the stamper is built today and reuse it.

- [ ] **Step 3: Request every screen** — `for s in describe reading name trades looks reads skills decides review run; do curl -s -o /dev/null -w "$s %{http_code}\n" "http://localhost:3001/studio/new?step=$s"; done` → all 200 (or 307 to sign-in on the guarded host; use the preview door if `previewAllowed`).

- [ ] **Step 4: Gates, commit**

```bash
git commit -m "Describe an agent in a line, review what it became, and watch it think for the first time

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- apps/web/src/features/studio apps/web/src/app/studio apps/web/test
```

---

## Task 12: Web — the home after the first run

**Files:**

- Create: `apps/web/src/features/studio/home/{home.tsx, status.ts, strip.tsx, agent-card.tsx, wallet-card.tsx, deposit-sheet.tsx, schedule.tsx, picks.tsx, next-up.tsx}` and `home.module.css`
- Modify: `apps/web/src/features/studio/studio.tsx` (renders `Home` as the default section when an agent exists)
- Test: `apps/web/test/studio-status.test.ts`

- [ ] **Step 1: `status.ts`, pure, failing test first** — from `(run: Run | null, events: RunEvent[], agent: Agent)` derive `{ pill: "WORKING"|"FIRST CALL IN"|"LIVE", mood: "THINKING"|"RESEARCHING"|"PICKED"|"WAITING", moodSub, say, stripLine }` with the canvas's rules (`step < 3` → THINKING; a `selection` event → RESEARCHING; `completed` + TRADE → PICKED; schedule on → WAITING / LIVE; `say` per state, "Fund my wallet and I can keep going on my own." when unfunded). Test each branch.

- [ ] **Step 2: The pieces** — `wallet-card.tsx` (`id="home-wallet"`: balance from `agent.wallet`, address, Copy, Deposit → `deposit-sheet.tsx` with amounts 10/25/50/100, the two limit rows → `PUT /limits`, "Deposit N AUSD · confirm with passkey" → prepare → stamp → confirm → re-read the agent); `schedule.tsx` (`id="home-schedule"`: interval picker 3h/6h/12h/daily → `PUT /config` `intervalHours`; the switch reads `agent.canSchedule`, title and note from `reason`); `picks.tsx` (`id="home-picks"`: empty / looking / done with range bar, market diamond, paper tag, "Full reasoning →" to the existing pick detail); `next-up.tsx` (`id="home-next"`: "Fund its wallet" until `balanceAusd ≥ 10`); the menu's "+ New agent" reads `agent.canCreateAnother`. `?stage=live|researching|decided` switches the fixture for the harness when `previewAllowed`.

- [ ] **Step 3: Request, gates, commit**

```bash
git commit -m "A home for the agent: what it holds, when it runs, what it called

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- apps/web/src/features/studio apps/web/test
```

---

## Task 13: The sub-organization is born in one place

**Files:**

- Modify: `apps/web/src/app/(auth)/passkey/page.tsx`, `apps/web/src/app/(auth)/signup/page.tsx`, `apps/web/src/app/(auth)/signin/page.tsx`, `apps/web/src/features/auth/components/passkey-flow.tsx`
- Test: `apps/web/test/passkey-flow.test.ts` (extend or create for the pure `enrolmentStore`/mode decision)

- [ ] **Step 1** — `PasskeyFlow` gains a required `mode: "add"` at those three call sites (the enrol mode is only rendered by the studio's ceremony); `/passkey` with no sub-organization shows "Your first agent creates your wallet" with a link to `/studio/new` instead of the enrol sheet. Signup/signin stop rendering the enrol half. The design routes for `/passkey`, `/signup`, `/signin` keep proving their selectors — check `routes.mjs` and update the `proves` if the enrol sheet was what they proved.

- [ ] **Step 2: Gates, commit**

```bash
git commit -m "A wallet is born with the first agent, nowhere else

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- apps/web/src apps/web/test scripts/design/routes.mjs
```

---

## Task 14: The design harness measures every state

**Files:** `scripts/design/routes.mjs`, `scripts/design/fixture-api.mjs` (studio fixtures for `/v1/studio/*` under the preview door), `apps/web/AGENTS.md`, `workers/api/AGENTS.md`, `packages/core/AGENTS.md`, `packages/infrastructure/AGENTS.md`

- [ ] **Step 1** — routes: `studio-new-describe` … `studio-new-run` (ten, `?step=`), each proving its `#create-<step>` id; `studio-home-live|researching|decided` proving `#home-wallet`, `#home-picks`, `#home-schedule`. The fixture API answers `/v1/studio/agents/draft` with a fixed draft and `/v1/studio/agents/:id` with a funded and an unfunded agent, so both lock states render.

- [ ] **Step 2** — run the four checks and shots; every new route "looked at"; open `studio-new-review-desktop.png`, `studio-new-run-desktop.png`, `studio-home-decided-desktop.png` and describe them.

- [ ] **Step 3: AGENTS.md** — each package's file describes the new modules (draft, style, brief, locks, agent-wallet policies, activities, erc20, the studio routes) in its existing register. Commit:

```bash
git commit -m "Measure every screen of creation and the home, and describe the new modules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- scripts/design apps/web/AGENTS.md workers/api/AGENTS.md packages/core/AGENTS.md packages/infrastructure/AGENTS.md packages/api-schema/AGENTS.md
```

---

## Task 15: The runner, locally, and one real agent

**Files:** `workers/research/.dev.vars.example` (names only), `docs/specs/studio-create-and-fund-v1.md` (`## Validation`)

- [ ] **Step 1** — with the person's keys in `workers/research/.dev.vars` and `MODEL_*` in `workers/api/.dev.vars` (never printed), start the research worker per `workers/research/AGENTS.md` on its own port; `curl` its health.

- [ ] **Step 2** — create one agent through `/studio/new` with a real passkey on the local stack: four prompts on the first agent; the trace real; the decision real; the paper order real if TRADE; the balance read from the chain after a testnet deposit from the master wallet (needs testnet AUSD in the master; say so if it has none, and record the deposit path as unverified).

- [ ] **Step 3** — `## Validation`: date, every gate's exit status, the harness's route count, what each screen showed, the number of passkey prompts observed, and **every place the plan and reality differed**. Commit and push:

```bash
git commit -m "Record the first agent created with its wallet and its first call on paper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- docs/specs/studio-create-and-fund-v1.md workers/research/.dev.vars.example
git push origin codex/user-profiles-and-products
```

---

## What this plan does not do

Perpl and beats other than sports (Soon). Chat. Face, voice, X, publishing. Token. The delegated
user's venue list stays empty, so it can sign nothing yet; live trading fills it. Withdrawal to the
master. A runtime hook for the paper order (the studio triggers it). Streaming the draft field by
field.

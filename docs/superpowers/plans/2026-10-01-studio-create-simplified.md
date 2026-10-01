# Studio Simplified Agent Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the studio's two creation flows (the brief with its paper run, and `/studio/new`) with one short screen. The agent's wallet is created and funded first (10 AUSD and 0.5 MON), and "Create {name}" signs the wallet's policies and creates the agent as a draft, as `docs/specs/studio-create-simplified-v1.md` describes.

**Architecture:**

- **Core** gains a pure creation module (voices, avatar patterns, starter caps, minimums, the draft config builder) and generalizes the AUSD deposit into master↔agent transfers of AUSD or MON.
- **Infrastructure** adds `wallets.transfers` and `agents.agent_profiles.avatar_pattern`, a native-transfer adapter, and a draft insert that links the wallet.
- **The API**:
  - drops the handle from the agent-wallet ceremony;
  - checks funding before the policies are prepared;
  - adds `GET /v1/studio/wallets` and the transfer routes;
  - replaces the drafts body.
- **The web app** replaces `EmptyHome` with a `NewAgent` screen built from pure, node-testable modules, and deletes `/studio/new`, `features/studio/create` and the brief's paper-run UI.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Hono on Cloudflare Workers, Drizzle and pg, viem (serialization only), Next.js App Router with React client components, CSS modules on `@pickler/ui` tokens, `node:test` with tsx.

---

## Read before starting

- Spec: `docs/specs/studio-create-simplified-v1.md`.
- Repo rules (`AGENTS.md` and each package's `AGENTS.md`):
  - Commit **by path** (`git commit -m … -- <paths>`), never a bare `git commit`.
  - Never `git clean`, `checkout .`, `reset --hard`, `restore` or a bare `stash`. Don't push.
  - Don't touch the real Supabase DB.
- Web pure modules (`apps/web/src/features/studio/**/model.ts`, `ceremony.ts` and the like) are
  required from `node:test` through CommonJS. They **must not value-import** `@pickler/api-schema`
  or `@pickler/core`; they restate constants and say so in a comment (see
  `apps/web/src/features/studio/brief/model.ts:1-10`).
- The design check is strict (`npm run design:source`): no colour literals, tokens only
  (`packages/ui/src/styles.css`), every CSS class used, every token defined.

### Where the spec and the code disagree (decided here, flagged to the owner)

1. **Leverage lives at `config.maxLeverage`, not `spend.maxLeverage`.**
   `AgentConfig.maxLeverage` already exists, with `LEVERAGE_BOUNDS` and `assertMaxLeverage`
   (`packages/core/src/features/research/types.ts:76-77, 535-541`). The plan uses it.
2. **Voice is stored at `config.voice`, not `brief.voice`.** `normalizeBrief` rebuilds the brief
   from its five fields (`types.ts:505-513`), so a `voice` inside it would be dropped on every
   write.
3. **Draft configs are Perpl-shaped.** The shape is the one `PostgresPerpsStudyStore` writes
   (`packages/infrastructure/src/persistence/perps-study-store.ts:211-219`): PERP tools, `perpl`
   `{ network: "testnet", markets: ["BTC","ETH"] }`, `perpsPaper`, and plugins
   `["perpl","perps-paper"]` plus `"exa"` when the web is on. **Running** such an agent from the
   studio depends on `perpl-agent-runtime-v1` (PR #65). Drafts are created with the schedule off,
   as today.
4. **The deposit routes stay as they are.** The spec makes `/agents/:id/deposit/*` wrappers over
   transfers. The plan extracts the shared stamped-transfer checks into one helper that both use,
   which gives the same safety with less churn. Deposits keep recording in `wallets.deposits`
   only.
5. **`preview-runs` becomes unused by the web.** Only `EmptyHome` calls it
   (`apps/web/src/features/studio/home/empty.tsx:199`). The spec said the studio home uses it,
   which is wrong. The plan deletes the web side and leaves the API, worker and tables in place
   for a separate cleanup; listed as a known leftover in Task 13.

---

## File structure

**Core (`packages/core`)**

- Create `src/features/studio/create.ts`: `VOICES`, `AVATAR_PATTERNS`, `STARTER_CAPS`,
  `MIN_START_MICRO_AUSD`, `MIN_START_MON_WEI`, `DEFAULT_BRIEF`, `prepareDraft()`,
  `fundingShortfall()` and `WalletUnderfundedError`.
- Modify `src/features/research/types.ts`: add `voice?: VoiceKey` to `AgentConfig` and validate it
  in `assertConfig`.
- Modify `src/features/studio/access.ts`: the new `createDraft` input on `StudioDirectory`.
- Modify `src/features/wallets/ports/custody.ts`:
  - widen `DepositChain` with native transfers;
  - add `WalletBalanceReader`;
  - add repository methods for unlinked wallets, the wallet list and transfers.
- Modify `src/features/wallets/application/custody.ts`:
  - `prepareAgentWallet` and `confirmAgentWallet` without a handle;
  - the funding check in `preparePolicies`;
  - `listWallets`;
  - `prepareTransfer` and `confirmTransfer`;
  - the shared `checkStampedTransfer`.
- Modify `src/features/wallets/domain/deposit.ts`: `TransferAlreadyRecordedError`,
  `InvalidTransferError` and `InsufficientFundsError`.
- Modify `src/index.ts`: export `create.ts`.
- Tests: create `test/studio-create.test.ts` and `test/custody-transfer.test.ts`; modify
  `test/custody-agent-wallet.test.ts`.

**Infrastructure (`packages/infrastructure`)**

- Modify `src/persistence/product/wallets.ts` (the `transfers` table) and
  `src/persistence/product/agents.ts` (`avatarPattern`).
- Generate `drizzle/0023_agent_wallet_transfers_and_avatar.sql` and its meta.
- Modify `src/persistence/custody-store.ts`: `findUnlinkedWallet`, `countAgentWallets`,
  `listAgentWallets`, `saveTransfer` and `transferRecorded`.
- Modify `src/turnkey/turnkey-activities.ts`: `createAgentWallet` takes `name`.
- Modify `src/chain/deposit-tx.ts`: `buildNativeTransferTx`, `inspectNativeTransfer`, and the
  wiring into `createAusdDepositChain`.
- Modify `src/studio/directory.ts`: `createDraft` with a wallet and no preview.
- Tests: modify `test/turnkey-activities.test.ts`, `test/studio-draft.test.ts` and the
  deposit-tx test.

**API (`workers/api`)**

- Modify `src/routes/signing.ts`: the wallet ceremony without a handle.
- Modify `src/http/error-handler.ts`: `wallet_underfunded`.
- Modify `src/routes/studio.ts`: `GET /wallets`, the transfer routes, the new `POST /drafts`;
  later, remove `POST /agents` and `POST /agents/draft`.
- Modify `src/container.ts`: pass `balances` to the custody service.
- Modify `packages/api-schema/src/studio.ts`: the new `draftCreateSchema` and the transfer and
  wallets schemas.
- Tests: modify `test/signing.test.ts`, `test/studio-drafts-route.test.ts` and
  `test/studio-wallet-route.test.ts`; create `test/studio-transfers-route.test.ts`.

**Web (`apps/web`)**

- Create `src/features/studio/new-agent/`:
  - `model.ts` (pure): the form, labels, minimums, voices, patterns and transfer validation;
  - `ceremony.ts` (pure): the wallet sequence and the create sequence;
  - `fixture.ts`: staged states for the design harness;
  - `new-agent.tsx`: the screen;
  - `identity.tsx`: name, handle and avatar button;
  - `voice.tsx`;
  - `reads.tsx`: Perpl and Web;
  - `advanced.tsx`;
  - `wallet-panel.tsx`;
  - `passkey-sheet.tsx`;
  - `wallets-modal.tsx`;
  - `credits-modal.tsx`;
  - `avatar-picker.tsx`;
  - `new-agent.module.css`.
- Modify:
  - `src/features/studio/api.ts`: the new routes, without the handle;
  - `src/features/studio/studio.tsx`: render `NewAgent`, the "new" view and the stages;
  - `src/features/studio/home/stage.ts`: the create stages replace the brief stages;
  - `src/features/studio/home/menu.tsx`: "+ New agent" calls `onNew`;
  - `src/features/studio/home/home.tsx`: pass `onNew` through.
- Move `src/features/studio/create/gate.ts` to `src/features/studio/home/gate.ts`.
- Delete `src/app/studio/new/`, `src/features/studio/create/`, `src/features/studio/brief/` and
  `src/features/studio/home/empty.tsx`, together with their tests.
- Tests: create `test/studio-new-agent.test.ts` and `test/studio-new-agent-ceremony.test.ts`.

**Design harness:** modify `scripts/design/routes.mjs`: the create stages replace `brief-*` and
`/studio/new?step=*`.

---

### Task 1: Core creation module (voices, patterns, caps, minimums, draft config)

**Files:**

- Create: `packages/core/src/features/studio/create.ts`
- Modify: `packages/core/src/features/research/types.ts` (`AgentConfig` gets `voice`; `assertConfig` checks it)
- Modify: `packages/core/src/index.ts:182-186` (add the export)
- Test: `packages/core/test/studio-create.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/studio-create.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_PATTERNS,
  DEFAULT_BRIEF,
  MIN_START_MICRO_AUSD,
  MIN_START_MON_WEI,
  STARTER_CAPS,
  VOICES,
  WalletUnderfundedError,
  fundingShortfall,
  prepareDraft,
  type CreateDraftInput,
} from "../src/features/studio/create.js";
import { BriefError, PilotError, assertConfig } from "../src/features/research/types.js";

const input = (patch: Partial<CreateDraftInput> = {}): CreateDraftInput => ({
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: { ...DEFAULT_BRIEF },
  caps: { ...STARTER_CAPS },
  walletId: "wal-agent",
  ...patch,
});

test("there are six voices, keyed and named as the canvas names them", () => {
  assert.deepEqual(
    VOICES.map((voice) => voice.name),
    ["Analyst", "Contrarian", "Trash talker", "Deadpan", "Hype", "Professor"],
  );
});

test("there are six avatar patterns of sixteen cells each", () => {
  assert.equal(AVATAR_PATTERNS.length, 6);
  assert.ok(AVATAR_PATTERNS.every((pattern) => /^[01]{16}$/.test(pattern)));
});

test("the starter caps are 5 per trade, 20 per day and 1×", () => {
  assert.deepEqual(STARTER_CAPS, { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 });
});

test("the minimums to start are 10 AUSD and 0.5 MON in base units", () => {
  assert.equal(MIN_START_MICRO_AUSD, 10_000_000n);
  assert.equal(MIN_START_MON_WEI, 500_000_000_000_000_000n);
});

test("a draft's config is a valid Perpl paper config with the brief, caps and voice", () => {
  const { config } = prepareDraft(input());
  assertConfig(config);
  assert.deepEqual(config.perpl, { version: 1, network: "testnet", markets: ["BTC", "ETH"] });
  assert.deepEqual(config.plugins, { version: 1, enabled: ["perpl", "perps-paper"] });
  assert.deepEqual(config.spend, { perCallAusd: 5, perDayAusd: 20 });
  assert.equal(config.maxLeverage, 1);
  assert.equal(config.voice, "analyst");
  assert.deepEqual(config.brief?.reads, []);
});

test("the web on adds Exa, its tools and its sites", () => {
  const { config } = prepareDraft(
    input({ sources: { web: { mode: "prefer", sites: ["coindesk.com"] } } }),
  );
  assert.deepEqual(config.plugins?.enabled, ["perpl", "perps-paper", "exa"]);
  assert.ok(config.tools.includes("searchWeb"));
  assert.deepEqual(config.sources?.web, { mode: "prefer", sites: ["coindesk.com"] });
});

test("the web off is null in sources and no Exa tool", () => {
  const { config } = prepareDraft(input());
  assert.equal(config.sources?.web, null);
  assert.ok(!config.tools.includes("searchWeb"));
});

test("the profile carries the accent, the pattern and the voice's name", () => {
  const { profile } = prepareDraft(
    input({ voice: "trash_talker", avatar: { accent: "blue", pattern: 3 } }),
  );
  assert.deepEqual(profile, { accent: "blue", avatarPattern: 3, voice: "Trash talker" });
});

test("an unknown voice is refused", () => {
  assert.throws(
    () => prepareDraft(input({ voice: "loud" as never })),
    (error: unknown) => error instanceof PilotError && error.code === "INVALID_INPUT",
  );
});

test("a pattern outside 0 to 5 is refused", () => {
  assert.throws(() => prepareDraft(input({ avatar: { accent: "lime", pattern: 6 } })), PilotError);
});

test("an unknown accent is refused", () => {
  assert.throws(
    () => prepareDraft(input({ avatar: { accent: "teal" as never, pattern: 0 } })),
    PilotError,
  );
});

test("a brief with no entry rule is refused naming the section", () => {
  assert.throws(
    () => prepareDraft(input({ brief: { ...DEFAULT_BRIEF, entersWhen: [] } })),
    (error: unknown) => error instanceof BriefError && error.field === "entersWhen",
  );
});

test("a day's cap below a trade's is refused", () => {
  assert.throws(
    () => prepareDraft(input({ caps: { perTradeAusd: 10, perDayAusd: 5, maxLeverage: 1 } })),
    PilotError,
  );
});

test("leverage above 10 is refused", () => {
  assert.throws(
    () => prepareDraft(input({ caps: { ...STARTER_CAPS, maxLeverage: 11 } })),
    PilotError,
  );
});

test("'only' with no sites is refused", () => {
  assert.throws(
    () => prepareDraft(input({ sources: { web: { mode: "only", sites: [] } } })),
    PilotError,
  );
});

test("enough of both is no shortfall", () => {
  assert.equal(
    fundingShortfall({ ausdMicro: MIN_START_MICRO_AUSD, monWei: MIN_START_MON_WEI }),
    null,
  );
});

test("too little MON is a shortfall naming both balances and both minimums", () => {
  assert.deepEqual(fundingShortfall({ ausdMicro: 25_000_000n, monWei: 1n }), {
    ausdMicro: "25000000",
    monWei: "1",
    minAusdMicro: "10000000",
    minMonWei: "500000000000000000",
  });
});

test("a balance that could not be read is a shortfall, never enough", () => {
  assert.notEqual(fundingShortfall({ ausdMicro: null, monWei: MIN_START_MON_WEI }), null);
});

test("WalletUnderfundedError carries the shortfall and the code", () => {
  const shortfall = fundingShortfall({ ausdMicro: 0n, monWei: 0n })!;
  const error = new WalletUnderfundedError(shortfall);
  assert.equal(error.code, "WALLET_UNDERFUNDED");
  assert.deepEqual(error.detail, shortfall);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test packages/core/test/studio-create.test.ts`
Expected: FAIL with `Cannot find module '../src/features/studio/create.js'`.

- [ ] **Step 3: Add `voice` to `AgentConfig`**

In `packages/core/src/features/research/types.ts`, after the `maxLeverage` field (line 77), add:

```ts
  /** The voice its posts are written in (docs/specs/studio-create-simplified-v1.md D8). */
  voice?: import("../studio/create.js").VoiceKey | undefined;
```

In `assertConfig`, after the `maxLeverage` check (line 701-703), add:

```ts
if (config.voice !== undefined && !VOICE_KEYS.includes(config.voice)) {
  throw new PilotError("INVALID_INPUT", "Unknown voice");
}
```

At the top of `types.ts`, define the keys here, not in `create.ts`, so there is no import cycle at
runtime:

```ts
/** The six voices' keys; `features/studio/create.ts` names and samples them. */
export const VOICE_KEYS = [
  "analyst",
  "contrarian",
  "trash_talker",
  "deadpan",
  "hype",
  "professor",
] as const;
```

Change the field to `voice?: (typeof VOICE_KEYS)[number] | undefined;` instead of the import type.

- [ ] **Step 4: Write `create.ts`**

```ts
// packages/core/src/features/studio/create.ts
/**
 * Creating an agent on one screen (docs/specs/studio-create-simplified-v1.md): the voices, the
 * avatar patterns, the starter caps, the minimums a wallet must hold, the brief a new agent starts
 * with, and the one path from what the screen sent to the draft's config and profile.
 */
import { ACCENTS, type Accent } from "../landing/domain/landing.js";
import { PERP_TOOLS } from "../perps/types.js";
import {
  DEFAULT_CONFIG,
  PilotError,
  VOICE_KEYS,
  assertBrief,
  assertConfig,
  assertMaxLeverage,
  assertSpendLimits,
  normalizeBrief,
  type AgentConfig,
  type WebMode,
} from "../research/types.js";

export type VoiceKey = (typeof VOICE_KEYS)[number];

/** The canvas's six voices and the first post each would write. */
export const VOICES: readonly { key: VoiceKey; name: string; sample: string }[] = [
  {
    key: "analyst",
    name: "Analyst",
    sample: "Long BTC at 3×, 25 AUSD. Headline first, price second. Out by the close.",
  },
  {
    key: "contrarian",
    name: "Contrarian",
    sample: "Everyone is long and paying for it. That is the whole reason I am short.",
  },
  {
    key: "trash_talker",
    name: "Trash talker",
    sample: "You saw the headline a minute after me. I was already filled.",
  },
  { key: "deadpan", name: "Deadpan", sample: "Long BTC. 25 AUSD. 3×. That is the post." },
  { key: "hype", name: "Hype", sample: "WE ARE LONG. Full clip. Let it run." },
  {
    key: "professor",
    name: "Professor",
    sample: "Funding at 0.09% with OI up 22% is a crowded trade by any definition. Fading it.",
  },
];

/** The avatar picker's six 4×4 patterns, row by row; "1" is a filled cell. */
export const AVATAR_PATTERNS = [
  "1001011001101001",
  "1111100110011111",
  "0110100110010110",
  "1010010110100101",
  "1100110000110011",
  "0000011001100000",
] as const;

/** Small on purpose for a first agent (D10). */
export const STARTER_CAPS = { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 } as const;

/** What the agent's wallet must hold before it can be created (D4): 10 AUSD and 0.5 MON. */
export const MIN_START_MICRO_AUSD = 10_000_000n;
export const MIN_START_MON_WEI = 500_000_000_000_000_000n;

/** The working brief a new agent starts with: the canvas's Wire. */
export const DEFAULT_BRIEF = {
  thesis:
    "Headlines move BTC and ETH before the order book does. The edge is the 30 to 90 seconds between a credible headline and the first big print.",
  entersWhen: [
    "Two of my sources carry the same headline within 60s",
    "Price has moved less than 0.3% since the headline",
    "Funding is not already leaning my way by more than 0.05%",
  ],
  exitsWhen: [
    "+2% take profit or −1% stop, whichever comes first",
    "Four hours after entry, no matter what",
    "A second headline contradicts the first",
  ],
  never: [
    "Trade a headline from a single source",
    "Hold through a funding print",
    "Add to a losing position",
  ],
} as const;

export interface CreateDraftInput {
  name: string;
  handle: string;
  voice: VoiceKey;
  avatar: { accent: Accent; pattern: number };
  sources: { web: { mode: WebMode; sites: string[] } | null };
  brief: {
    thesis: string;
    entersWhen: readonly string[];
    exitsWhen: readonly string[];
    never: readonly string[];
  };
  caps: { perTradeAusd: number; perDayAusd: number; maxLeverage: number };
  walletId: string;
}

/** What the draft's profile row gets: the avatar and the voice's name. */
export interface DraftProfile {
  accent: Accent;
  avatarPattern: number;
  voice: string;
}

/**
 * Normalize, check, and build. Brief problems are `BriefError` (400 naming the section); caps,
 * voice, avatar and sources are `PilotError("INVALID_INPUT")`.
 */
export function prepareDraft(input: CreateDraftInput): {
  config: AgentConfig;
  profile: DraftProfile;
} {
  const voice = VOICES.find((candidate) => candidate.key === input.voice);
  if (!voice) {
    throw new PilotError("INVALID_INPUT", "Unknown voice");
  }
  if (!(ACCENTS as readonly string[]).includes(input.avatar.accent)) {
    throw new PilotError("INVALID_INPUT", "Unknown accent");
  }
  if (
    !Number.isInteger(input.avatar.pattern) ||
    input.avatar.pattern < 0 ||
    input.avatar.pattern >= AVATAR_PATTERNS.length
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown avatar pattern");
  }
  const brief = normalizeBrief({
    thesis: input.brief.thesis,
    reads: [],
    entersWhen: [...input.brief.entersWhen],
    exitsWhen: [...input.brief.exitsWhen],
    never: [...input.brief.never],
  });
  assertBrief(brief);
  const spend = { perCallAusd: input.caps.perTradeAusd, perDayAusd: input.caps.perDayAusd };
  assertSpendLimits(spend);
  assertMaxLeverage(input.caps.maxLeverage);
  const web = input.sources.web;
  const config: AgentConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    tools: [...PERP_TOOLS, ...(web ? (["searchWeb", "readPage"] as const) : [])],
    perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
    perpsPaper: { version: 1, policy: "conservative-1x-v1" },
    plugins: { version: 1, enabled: ["perpl", "perps-paper", ...(web ? (["exa"] as const) : [])] },
    sources: { web: web ? { mode: web.mode, sites: [...web.sites] } : null, books: [] },
    skills: [],
    brief,
    spend,
    maxLeverage: input.caps.maxLeverage,
    voice: input.voice,
  };
  assertConfig(config);
  return {
    config,
    profile: {
      accent: input.avatar.accent,
      avatarPattern: input.avatar.pattern,
      voice: voice.name,
    },
  };
}

/** Balances as base-unit strings, and the minimums, for 409 WALLET_UNDERFUNDED's detail. */
export interface FundingShortfall {
  ausdMicro: string | null;
  monWei: string | null;
  minAusdMicro: string;
  minMonWei: string;
}

/** Null when both minimums are met. An unread balance (null) is never enough. */
export function fundingShortfall(balances: {
  ausdMicro: bigint | null;
  monWei: bigint | null;
}): FundingShortfall | null {
  const enough =
    balances.ausdMicro !== null &&
    balances.monWei !== null &&
    balances.ausdMicro >= MIN_START_MICRO_AUSD &&
    balances.monWei >= MIN_START_MON_WEI;
  if (enough) {
    return null;
  }
  return {
    ausdMicro: balances.ausdMicro === null ? null : balances.ausdMicro.toString(),
    monWei: balances.monWei === null ? null : balances.monWei.toString(),
    minAusdMicro: MIN_START_MICRO_AUSD.toString(),
    minMonWei: MIN_START_MON_WEI.toString(),
  };
}

/** 409: the agent's wallet does not hold the minimums to start. */
export class WalletUnderfundedError extends PilotError {
  constructor(public readonly detail: FundingShortfall) {
    super("WALLET_UNDERFUNDED", "Fund its wallet with at least 10 AUSD and 0.5 MON first");
  }
}
```

If `assertConfig` refuses `sources.web: null` or `categoryIds` with a perps config, read
`types.ts:640-720` and adjust the config to what it accepts. The perps study's config passes it
with `categoryIds: []` from `DEFAULT_CONFIG`. Do not loosen `assertConfig`.

- [ ] **Step 5: Export it**

In `packages/core/src/index.ts`, after line 186 (`export * from "./features/studio/locks.js";`),
add:

```ts
export * from "./features/studio/create.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build:shared >/dev/null && node --import tsx --test packages/core/test/studio-create.test.ts packages/core/test/brief-config.test.ts`
Expected: PASS, every test.

- [ ] **Step 7: Commit**

```bash
git commit -m "Core: one-screen agent creation (voices, avatar patterns, starter caps, minimums, draft config)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/core/src/features/studio/create.ts packages/core/src/features/research/types.ts packages/core/src/index.ts packages/core/test/studio-create.test.ts
```

---

### Task 2: Migration and persistence (transfers, avatar pattern, the store's new reads)

**Files:**

- Modify: `packages/infrastructure/src/persistence/product/wallets.ts` (after `deposits`, line ~128)
- Modify: `packages/infrastructure/src/persistence/product/agents.ts:79-100` (`agentProfiles`)
- Create (generated): `packages/infrastructure/drizzle/0023_agent_wallet_transfers_and_avatar.sql`, `packages/infrastructure/drizzle/meta/0023_snapshot.json`, `meta/_journal.json` (updated)
- Modify: `packages/core/src/features/wallets/ports/custody.ts:190-238` (`AgentWalletRepository`)
- Modify: `packages/infrastructure/src/persistence/custody-store.ts`
- Test: `packages/infrastructure/test/custody-store-transfers.test.ts` (new; DB-backed, skipped without `TEST_DATABASE_URL` like the other store tests)

- [ ] **Step 1: Add the tables to the schema**

In `wallets.ts`, after `deposits`:

```ts
/** Master ↔ agent moves of AUSD or MON, signed by the person's passkey. The chain is the truth; this is the receipt. */
export const transfers = wallets
  .table(
    "transfers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      fromWalletId: text("from_wallet_id").notNull(),
      toWalletId: text("to_wallet_id").notNull(),
      token: text("token").notNull(),
      /** Micro-AUSD or wei, by `token`. */
      amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
      txHash: text("tx_hash").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("transfers_tx_key").on(t.txHash),
      index("transfers_user_idx").on(t.userId),
      check("transfers_token", sql`${t.token} in ('ausd', 'mon')`),
      check("transfers_amount_positive", sql`${t.amount} > 0`),
      check("transfers_tx_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();
```

Add `numeric` to the `drizzle-orm/pg-core` import at the top of `wallets.ts`.

In `agents.ts` `agentProfiles`, after `accent`:

```ts
      /** One of the six avatar patterns (core's `AVATAR_PATTERNS`), by index. */
      avatarPattern: smallint("avatar_pattern").notNull().default(0),
```

Add the check `check("agent_profiles_avatar_pattern", sql\`${t.avatarPattern} between 0 and 5\`)`to the table's constraint list, and`smallint` to its import.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate --workspace=@pickler/infrastructure -- --name agent_wallet_transfers_and_avatar`
Expected: a new `drizzle/0023_agent_wallet_transfers_and_avatar.sql` with
`CREATE TABLE "wallets"."transfers"`, its RLS line, index and checks, and
`ALTER TABLE "agents"."agent_profiles" ADD COLUMN "avatar_pattern" smallint DEFAULT 0 NOT NULL`
with its check.

Open the SQL and confirm it touches nothing else. If drizzle-kit drifted elsewhere, stop and
report it; do not hand-edit other tables.

- [ ] **Step 3: Apply it to the local Docker database only**

Run: `cd packages/infrastructure && DATABASE_MIGRATION_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler node --import tsx src/persistence/migrate.ts`
Expected: `Pickler migrations applied.`

Never point this at Supabase.

- [ ] **Step 4: Widen the repository port**

In `packages/core/src/features/wallets/ports/custody.ts`, inside `AgentWalletRepository`, add:

```ts
  /** This person's newest agent wallet that no agent is linked to, whatever its name. */
  findUnlinkedWallet(userId: string): Promise<OrphanAgentWallet | null>;
  /** How many agent wallets this person has, linked or not: the next one is "Agent wallet N+1". */
  countAgentWallets(userId: string): Promise<number>;
  /** Every agent wallet of this person's, oldest first, with the agent it is linked to. */
  listAgentWallets(userId: string): Promise<
    {
      walletId: string;
      address: string;
      agentId: string | null;
      agentName: string | null;
      policiesApproved: boolean;
      caps: { perTradeAusd: number; perDayAusd: number; maxLeverage: number } | null;
    }[]
  >;
  saveTransfer(input: {
    userId: string;
    fromWalletId: string;
    toWalletId: string;
    token: "ausd" | "mon";
    amount: bigint;
    txHash: string;
  }): Promise<void>;
  /** Whether a transfer with this transaction hash (any case) is recorded. */
  transferRecorded(txHash: string): Promise<boolean>;
```

- [ ] **Step 5: Write the failing store test**

```ts
// packages/infrastructure/test/custody-store-transfers.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresCustodyStore } from "../src/persistence/custody-store.js";
import { TransferAlreadyRecordedError } from "@pickler/core";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL is not set";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HASH = `0x${"cd".repeat(32)}`;

test("an unlinked agent wallet is found whatever its name, and counted", { skip }, async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const store = new PostgresCustodyStore(pool);
    await pool.query("DELETE FROM wallets.wallets WHERE user_id=$1", [USER]);
    await store.saveWallet({
      userId: USER,
      walletId: "wal-test-1",
      subOrganizationId: "sub-test",
      kind: "agent",
      name: "Agent wallet 1",
      address: "0x3333333333333333333333333333333333333333",
      path: "m/44'/60'/0'/0/0",
    });
    assert.equal((await store.findUnlinkedWallet(USER))?.walletId, "wal-test-1");
    assert.equal(await store.countAgentWallets(USER), 1);
    assert.deepEqual(
      (await store.listAgentWallets(USER)).map((wallet) => wallet.agentId),
      [null],
    );
  } finally {
    await pool.end();
  }
});

test(
  "a transfer is recorded once; the same hash again is TransferAlreadyRecordedError",
  { skip },
  async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const store = new PostgresCustodyStore(pool);
      await pool.query("DELETE FROM wallets.transfers WHERE tx_hash=$1", [HASH]);
      const transfer = {
        userId: USER,
        fromWalletId: "master",
        toWalletId: "wal-test-1",
        token: "mon" as const,
        amount: 5n,
        txHash: HASH,
      };
      await store.saveTransfer(transfer);
      assert.equal(await store.transferRecorded(HASH.toUpperCase().replace("0X", "0x")), true);
      await assert.rejects(store.saveTransfer(transfer), TransferAlreadyRecordedError);
    } finally {
      await pool.end();
    }
  },
);
```

- [ ] **Step 6: Run it to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler node --import tsx --test packages/infrastructure/test/custody-store-transfers.test.ts`
Expected: FAIL (`store.findUnlinkedWallet is not a function`, or the core export is missing).
`TransferAlreadyRecordedError` comes in Task 3, Step 3; write it now in
`packages/core/src/features/wallets/domain/deposit.ts`:

```ts
/** A transfer with this transaction hash is already recorded (HTTP 409). */
export class TransferAlreadyRecordedError extends Error {
  constructor() {
    super("This transfer is already recorded");
    this.name = "TransferAlreadyRecordedError";
  }
}
```

Export it from `packages/core/src/index.ts`, in the `./features/wallets/domain/deposit.js` export
list at lines ~210-219.

- [ ] **Step 7: Implement the store methods**

In `packages/infrastructure/src/persistence/custody-store.ts`, beside `findOrphanWallet`
(line 218):

```ts
  async findUnlinkedWallet(userId: string): Promise<OrphanAgentWallet | null> {
    const { rows } = await this.pool.query<OrphanAgentWallet>(
      `SELECT w.wallet_id AS "walletId", a.address, w.approved_policy_ids AS "approvedPolicyIds"
         FROM wallets.wallets w
         JOIN wallets.wallet_accounts a ON a.wallet_id = w.wallet_id
        WHERE w.user_id = $1 AND w.kind = 'agent'
          AND NOT EXISTS (SELECT 1 FROM wallets.agent_wallets l WHERE l.wallet_id = w.wallet_id)
        ORDER BY w.created_at DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async countAgentWallets(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM wallets.wallets WHERE user_id = $1 AND kind = 'agent'",
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async listAgentWallets(userId: string) {
    const { rows } = await this.pool.query<{
      walletId: string;
      address: string;
      agentId: string | null;
      agentName: string | null;
      approvedPolicyIds: string[] | null;
      config: { spend?: { perCallAusd: number; perDayAusd: number }; maxLeverage?: number } | null;
    }>(
      `SELECT w.wallet_id AS "walletId", a.address, l.agent_id::text AS "agentId", ag.name AS "agentName",
              w.approved_policy_ids AS "approvedPolicyIds", pa.config
         FROM wallets.wallets w
         JOIN wallets.wallet_accounts a ON a.wallet_id = w.wallet_id
         LEFT JOIN wallets.agent_wallets l ON l.wallet_id = w.wallet_id
         LEFT JOIN agents.agents ag ON ag.id = l.agent_id
         LEFT JOIN pickler.product_agents p ON p.product_agent_id = l.agent_id
         LEFT JOIN pickler.agents pa ON pa.tenant_id = p.tenant_id AND pa.id = p.runtime_agent_id
        WHERE w.user_id = $1 AND w.kind = 'agent'
        ORDER BY w.created_at`,
      [userId],
    );
    return rows.map((row) => ({
      walletId: row.walletId,
      address: row.address,
      agentId: row.agentId,
      agentName: row.agentName,
      policiesApproved: (row.approvedPolicyIds?.length ?? 0) >= MIN_AGENT_WALLET_POLICIES,
      caps: row.config?.spend
        ? {
            perTradeAusd: row.config.spend.perCallAusd,
            perDayAusd: row.config.spend.perDayAusd,
            maxLeverage: row.config.maxLeverage ?? 1,
          }
        : null,
    }));
  }

  async saveTransfer(input: {
    userId: string;
    fromWalletId: string;
    toWalletId: string;
    token: "ausd" | "mon";
    amount: bigint;
    txHash: string;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO wallets.transfers (user_id, from_wallet_id, to_wallet_id, token, amount, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.userId, input.fromWalletId, input.toWalletId, input.token, input.amount.toString(), input.txHash.toLowerCase()],
      );
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === "23505" && constraint === "transfers_tx_key") {
        throw new TransferAlreadyRecordedError();
      }
      throw error;
    }
  }

  async transferRecorded(txHash: string): Promise<boolean> {
    const { rows } = await this.pool.query("SELECT 1 FROM wallets.transfers WHERE tx_hash = $1", [txHash.toLowerCase()]);
    return rows.length > 0;
  }
```

Import `MIN_AGENT_WALLET_POLICIES` and `TransferAlreadyRecordedError` from `@pickler/core` at the
top of the file. `MIN_AGENT_WALLET_POLICIES` is exported already; `directory.ts:6` imports it.

- [ ] **Step 8: Run the tests**

Run: `npm run build:shared >/dev/null && TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler node --import tsx --test packages/infrastructure/test/custody-store-transfers.test.ts`
Expected: PASS (2 tests).

Then run `npm run typecheck --workspace=@pickler/core`. It fails: every other
`AgentWalletRepository` fake (in `packages/core/test/*.test.ts`) lacks the new methods. Those fakes
are cast with `as unknown as AgentWalletRepository`, so the typecheck may still pass. If it does
not, add stub methods that throw `"not in this test"` to the failing fakes.

- [ ] **Step 9: Commit**

```bash
git commit -m "Wallets: transfers receipts and the avatar pattern; the store finds unlinked wallets and lists them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/infrastructure/src/persistence/product/wallets.ts packages/infrastructure/src/persistence/product/agents.ts packages/infrastructure/drizzle packages/core/src/features/wallets/ports/custody.ts packages/core/src/features/wallets/domain/deposit.ts packages/core/src/index.ts packages/infrastructure/src/persistence/custody-store.ts packages/infrastructure/test/custody-store-transfers.test.ts
```

---

### Task 3: The transfer service (native transfers, shared checks, wallet ceremony without a handle, the funding check)

**Files:**

- Modify: `packages/core/src/features/wallets/ports/custody.ts:153-169, 241-298` (`AgentWalletActivityBuilders.createAgentWallet` takes `name`; `DepositChain` gains native transfers; new `WalletBalanceReader`)
- Modify: `packages/core/src/features/wallets/domain/deposit.ts` (`InvalidTransferError`, `InsufficientFundsError`)
- Modify: `packages/core/src/features/wallets/application/custody.ts:540-800`
- Modify: `packages/infrastructure/src/turnkey/turnkey-activities.ts:70-79`
- Modify: `packages/infrastructure/src/chain/deposit-tx.ts`
- Test: `packages/core/test/custody-transfer.test.ts` (new), `packages/core/test/custody-agent-wallet.test.ts` (modify), `packages/infrastructure/test/turnkey-activities.test.ts:83` (modify), `packages/infrastructure/test/deposit-tx.test.ts` (modify; find it with `ls packages/infrastructure/test | grep deposit`)

- [ ] **Step 1: Widen the ports**

In `ports/custody.ts`:

```ts
// AgentWalletActivityBuilders
  /** One wallet named `name` ("Agent wallet N"), with the single Monad account. */
  createAgentWallet(input: { subOrganizationId: string; name: string } & Rebuild): UnsignedActivity;
```

```ts
/** What an unsigned plain MON transfer does: no calldata, value to `to`. */
export interface NativeTransferInspection {
  chainId: number;
  nonce: number;
  to: string;
  value: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

// DepositChain, add:
  /** The unsigned EIP-1559 plain transfer of `amount` wei from `from` to `to`. */
  prepareNativeTransfer(input: { from: string; to: string; amount: bigint }): Promise<string>;
  /** Null unless it is a canonically encoded unsigned EIP-1559 transfer with empty calldata. */
  inspectNativeTransfer(unsignedTransaction: string): NativeTransferInspection | null;

/** Native and AUSD balances in base units; null where the chain could not be read. */
export interface WalletBalanceReader {
  read(address: string): Promise<{ monWei: bigint | null; ausdMicro: bigint | null }>;
}
```

Add `balances?: WalletBalanceReader` to the deps type of `createCustodyService` in
`application/custody.ts`; find the deps interface with `grep -n "interface CustodyServiceDeps\|deps: {" packages/core/src/features/wallets/application/custody.ts`.

- [ ] **Step 2: Add the transfer errors**

In `domain/deposit.ts`:

```ts
/** The transfer asked for is not one a person may make: not master↔own agent wallet, or not a positive amount (HTTP 400). */
export class InvalidTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransferError";
  }
}

/** The source wallet holds less than the amount (HTTP 409). */
export class InsufficientFundsError extends Error {
  constructor() {
    super("The wallet does not hold that much");
    this.name = "InsufficientFundsError";
  }
}

/** The most gas a plain MON transfer may reserve: 21 000 and room for a contract recipient. */
export const MAX_NATIVE_TRANSFER_GAS = 100_000n;
```

Export all three from `packages/core/src/index.ts` (in the deposit export list).

- [ ] **Step 3: Write the failing core tests**

Create `packages/core/test/custody-transfer.test.ts`. Copy the fakes from
`packages/core/test/custody-deposit.test.ts:50-200` (the `encode` / `decode` JSON fake chain, the
repository, the activity builders and the forwarder), then extend them:

- `agentWallets` gains `findOwnedAgentWallet` (for `wal-agent` owned by `USER`), `saveTransfer`
  (pushes to `state.transfers`) and `transferRecorded`;
- the chain gains `prepareNativeTransfer` (encodes `{ chainId, nonce: 7, to, value: amount, gas: 21_000n, maxFeePerGas: 102n, maxPriorityFeePerGas: 2n }`) and `inspectNativeTransfer: decodeNative`;
- `deps.balances = { read: async (address) => state.balances[address] ?? { monWei: 0n, ausdMicro: 0n } }`.

Tests (one behaviour each):

```ts
test("funding an agent with MON prepares a plain transfer from the master to its wallet", async () => {
  const f = fakes();
  f.state.balances[MASTER] = { monWei: 10n ** 18n, ausdMicro: 0n };
  const service = createCustodyService(deps(f));
  await service.prepareTransfer(USER, {
    from: "master",
    to: "wal-agent",
    token: "MON",
    amount: 5n * 10n ** 17n,
  });
  assert.deepEqual(f.state.preparedNative, [
    { from: MASTER, to: AGENT_ADDRESS, amount: 5n * 10n ** 17n },
  ]);
});

test("pulling AUSD back signs with the agent wallet's address", async () => {
  const f = fakes();
  f.state.balances[AGENT_ADDRESS] = { monWei: 10n ** 18n, ausdMicro: 5_000_000n };
  const service = createCustodyService(deps(f));
  const unsigned = await service.prepareTransfer(USER, {
    from: "wal-agent",
    to: "master",
    token: "AUSD",
    amount: 1_000_000n,
  });
  assert.equal(JSON.parse(unsigned.body).parameters.signWith, AGENT_ADDRESS);
});

test("a transfer between two agent wallets is refused", async () => {
  const service = createCustodyService(deps(fakes()));
  await assert.rejects(
    service.prepareTransfer(USER, { from: "wal-agent", to: "wal-agent", token: "MON", amount: 1n }),
    InvalidTransferError,
  );
});

test("a zero amount is refused", async () => {
  const service = createCustodyService(deps(fakes()));
  await assert.rejects(
    service.prepareTransfer(USER, { from: "master", to: "wal-agent", token: "MON", amount: 0n }),
    InvalidTransferError,
  );
});

test("another person's agent wallet is AgentWalletNotFoundError", async () => {
  const service = createCustodyService(deps(fakes({ walletOwner: "someone-else" })));
  await assert.rejects(
    service.prepareTransfer(USER, { from: "master", to: "wal-agent", token: "MON", amount: 1n }),
    AgentWalletNotFoundError,
  );
});

test("more than the source holds is InsufficientFundsError", async () => {
  const f = fakes();
  f.state.balances[MASTER] = { monWei: 1n, ausdMicro: 0n };
  const service = createCustodyService(deps(f));
  await assert.rejects(
    service.prepareTransfer(USER, { from: "master", to: "wal-agent", token: "MON", amount: 2n }),
    InsufficientFundsError,
  );
});

test("a confirmed MON transfer is forwarded, broadcast, both balances forgotten, and recorded", async () => {
  const f = fakes();
  f.state.balances[MASTER] = { monWei: 10n ** 18n, ausdMicro: 0n };
  const service = createCustodyService(deps(f));
  const amount = 5n * 10n ** 17n;
  const unsigned = await service.prepareTransfer(USER, {
    from: "master",
    to: "wal-agent",
    token: "MON",
    amount,
  });
  const { txHash } = await service.confirmTransfer(
    USER,
    { from: "master", to: "wal-agent", token: "MON", amount },
    stamped(unsigned),
  );
  assert.equal(txHash, HASH);
  assert.deepEqual(f.state.forgotten.sort(), [AGENT_ADDRESS, MASTER].sort());
  assert.deepEqual(f.state.transfers, [
    {
      userId: USER,
      fromWalletId: "wal-master",
      toWalletId: "wal-agent",
      token: "mon",
      amount,
      txHash: HASH,
    },
  ]);
});

test("a stamped MON transfer to another address is refused before forwarding", async () => {
  // tamper `to` in the stamped JSON body (see custody-deposit.test.ts for the tamper helper)
});

test("a stamped MON transfer of another amount is refused", async () => {
  // tamper `value`
});

test("a repeated confirm is TransferAlreadyRecordedError and sends nothing", async () => {
  // record HASH first; expect rejects and f.state.broadcasts.length === 0
});
```

For the three tamper tests, reuse the deposit test's tamper helper. Find it with
`grep -n "tamper\|function stamped" packages/core/test/custody-deposit.test.ts`. Assert
`InvalidSignedActivityError`, the same class the deposit tests assert.

In `packages/core/test/custody-agent-wallet.test.ts`, replace each
`prepareAgentWallet(USER, "halftime")` with `prepareAgentWallet(USER)`, and each
`confirmAgentWallet(USER, "halftime", signed)` with `confirmAgentWallet(USER, signed)`. Change the
expected `walletName` to `"Agent wallet 1"` and the fake's `findOrphanWallet` to
`findUnlinkedWallet`. Add:

```ts
test("the second agent wallet is named Agent wallet 2", async () => {
  const f = fakes({ agentWallets: 1 }); // countAgentWallets answers 1
  const prepared = await createCustodyService(deps(f)).prepareAgentWallet(USER);
  assert.ok("unsigned" in prepared);
  assert.equal(JSON.parse(prepared.unsigned.body).parameters.walletName, "Agent wallet 2");
});

test("policies are not prepared for a wallet below the minimums", async () => {
  const f = fakes();
  f.state.balances[AGENT_ADDRESS] = { monWei: 0n, ausdMicro: 25_000_000n };
  await assert.rejects(
    createCustodyService(deps(f)).preparePolicies(USER, "wal-agent"),
    WalletUnderfundedError,
  );
});

test("policies are prepared once both minimums are met", async () => {
  const f = fakes();
  f.state.balances[AGENT_ADDRESS] = { monWei: MIN_START_MON_WEI, ausdMicro: MIN_START_MICRO_AUSD };
  await createCustodyService(deps(f)).preparePolicies(USER, "wal-agent");
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `node --import tsx --test packages/core/test/custody-transfer.test.ts packages/core/test/custody-agent-wallet.test.ts`
Expected: FAIL (`service.prepareTransfer is not a function`; the wrong argument count).

- [ ] **Step 5: Implement in `custody.ts`**

1. **`prepareAgentWallet(userId)` and `confirmAgentWallet(userId, signed)`.** Replace the
   functions at lines 549-616:

```ts
    async prepareAgentWallet(userId: string): Promise<{ existing: ExistingAgentWallet } | { unsigned: UnsignedActivity }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const orphan = await deps.agentWallets.findUnlinkedWallet(userId);
      if (orphan) {
        return {
          existing: {
            walletId: orphan.walletId,
            address: orphan.address,
            policiesApproved: (orphan.approvedPolicyIds?.length ?? 0) >= MIN_AGENT_WALLET_POLICIES,
          },
        };
      }
      return {
        unsigned: deps.agentActivities.createAgentWallet({
          subOrganizationId: account.subOrganizationId,
          name: await nextWalletName(userId),
        }),
      };
    },

    async confirmAgentWallet(userId: string, signed: SignedActivityRequest): Promise<AgentWallet> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const name = await nextWalletName(userId);
      assertStampedAsPrepared(signed, (timestampMs) =>
        deps.agentActivities.createAgentWallet({ subOrganizationId: account.subOrganizationId, name, timestampMs }),
      );
      // …unchanged from here (forward, completedResult, saveWallet), with `name` instead of `handle`.
    },
```

Add the helper beside `depositContext` (line 273):

```ts
/** "Agent wallet N", from what is recorded: the same at prepare and at confirm. */
async function nextWalletName(userId: string): Promise<string> {
  return `Agent wallet ${(await deps.agentWallets.countAgentWallets(userId)) + 1}`;
}
```

2. **The funding check in `preparePolicies`.** Before `return deps.agentActivities.createPolicies(…)`:

```ts
const wallet = await deps.agentWallets.findOwnedAgentWallet(userId, walletId);
if (!wallet) {
  throw new AgentWalletNotFoundError();
}
if (!deps.balances) {
  throw new DepositsUnavailableError();
}
const shortfall = fundingShortfall(await deps.balances.read(wallet.address));
if (shortfall) {
  throw new WalletUnderfundedError(shortfall);
}
```

`confirmPolicies` does **not** check balances. The stamp is already made, and refusing it would
strand an approved policy set. The drafts route checks again (Task 4).

3. **`listWallets(userId)`:**

```ts
    async listWallets(userId: string) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      if (!deps.balances) {
        throw new DepositsUnavailableError();
      }
      const balances = deps.balances;
      const agents = await deps.agentWallets.listAgentWallets(userId);
      const [master, ...each] = await Promise.all([
        balances.read(account.address),
        ...agents.map((wallet) => balances.read(wallet.address)),
      ]);
      return {
        master: { address: account.address, ...master! },
        agents: agents.map((wallet, index) => ({ ...wallet, ...each[index]! })),
        readAt: deps.now().getTime(),
      };
    },
```

4. **Transfers.** Add the types and the shared context:

```ts
export interface TransferRequest {
  /** "master", or one of the person's agent wallet ids. Exactly one side is "master". */
  from: string;
  to: string;
  token: "AUSD" | "MON";
  /** Base units: micro-AUSD or wei. */
  amount: bigint;
}

async function transferContext(userId: string, request: TransferRequest) {
  if (request.amount <= 0n) {
    throw new InvalidTransferError("The amount must be more than zero");
  }
  if ((request.from === "master") === (request.to === "master")) {
    throw new InvalidTransferError(
      "A transfer goes between the master wallet and one agent wallet",
    );
  }
  const chain = deps.deposits;
  if (!chain || !deps.balances) {
    throw new DepositsUnavailableError();
  }
  const account = await deps.repository.findByUserId(userId);
  if (!account) {
    throw new NoCustodyAccountError();
  }
  const agentWalletId = request.from === "master" ? request.to : request.from;
  const agent = await deps.agentWallets.findOwnedAgentWallet(userId, agentWalletId);
  if (!agent) {
    throw new AgentWalletNotFoundError();
  }
  const master = { walletId: account.masterWalletId, address: account.address };
  const source = request.from === "master" ? master : agent;
  const target = request.from === "master" ? agent : master;
  const held = await deps.balances.read(source.address);
  const available = request.token === "AUSD" ? held.ausdMicro : held.monWei;
  if (available === null || available < request.amount) {
    throw new InsufficientFundsError();
  }
  return { chain, account, source, target };
}
```

Then `prepareTransfer(userId, request)`:

```ts
    async prepareTransfer(userId: string, request: TransferRequest): Promise<UnsignedActivity> {
      const { chain, account, source, target } = await transferContext(userId, request);
      const unsignedTransaction =
        request.token === "AUSD"
          ? await chain.prepareTransfer({ from: source.address, to: target.address, amount: request.amount })
          : await chain.prepareNativeTransfer({ from: source.address, to: target.address, amount: request.amount });
      return deps.agentActivities.signTransaction({
        subOrganizationId: account.subOrganizationId,
        signWith: source.address,
        unsignedTransaction,
      });
    },
```

5. **Extract the stamped checks.** Move lines 707-770 of `confirmDeposit` (inspect → chain → token
   or native → value → gas → recipient → amount → fees → nonce → `assertStampedAsPrepared` →
   forward → signed transaction → `verifySignedTransfer`) into:

```ts
async function checkStampedTransfer(input: {
  chain: DepositChain;
  subOrganizationId: string;
  signer: string;
  recipient: string;
  token: "AUSD" | "MON";
  amount: bigint;
  signed: SignedActivityRequest;
}): Promise<{ signedTransaction: string }> {
  const unsignedTransaction = stampedUnsignedTransaction(input.signed);
  if (input.token === "AUSD") {
    const transfer = input.chain.inspectTransfer(unsignedTransaction);
    if (!transfer)
      throw new InvalidSignedActivityError("The stamped transaction is not a token transfer");
    if (transfer.chainId !== input.chain.chainId)
      throw new InvalidSignedActivityError("The stamped transaction is for another chain");
    if (!sameAddress(transfer.to, input.chain.token))
      throw new InvalidSignedActivityError("The stamped transaction moves another token");
    if (transfer.value !== 0n)
      throw new InvalidSignedActivityError("The stamped transaction sends native value");
    if (transfer.gas > MAX_DEPOSIT_GAS)
      throw new InvalidSignedActivityError("The stamped transaction reserves too much gas");
    if (!sameAddress(transfer.recipient, input.recipient))
      throw new InvalidSignedActivityError("The stamped transaction pays another wallet");
    if (transfer.amount !== input.amount)
      throw new InvalidSignedActivityError("The stamped transaction moves another amount");
    await checkFeesAndNonce(input.chain, transfer, input.signer);
  } else {
    const transfer = input.chain.inspectNativeTransfer(unsignedTransaction);
    if (!transfer)
      throw new InvalidSignedActivityError("The stamped transaction is not a plain transfer");
    if (transfer.chainId !== input.chain.chainId)
      throw new InvalidSignedActivityError("The stamped transaction is for another chain");
    if (transfer.gas > MAX_NATIVE_TRANSFER_GAS)
      throw new InvalidSignedActivityError("The stamped transaction reserves too much gas");
    if (!sameAddress(transfer.to, input.recipient))
      throw new InvalidSignedActivityError("The stamped transaction pays another wallet");
    if (transfer.value !== input.amount)
      throw new InvalidSignedActivityError("The stamped transaction moves another amount");
    await checkFeesAndNonce(input.chain, transfer, input.signer);
  }
  assertStampedAsPrepared(input.signed, (timestampMs) =>
    deps.agentActivities.signTransaction({
      subOrganizationId: input.subOrganizationId,
      signWith: input.signer,
      unsignedTransaction,
      timestampMs,
    }),
  );
  const activity = await deps.forwarder.forward(input.signed, {
    organizationId: input.subOrganizationId,
    allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.signTransaction],
  });
  const signedTransaction = completedResult(activity, "signTransactionResult")["signedTransaction"];
  if (typeof signedTransaction !== "string" || !signedTransaction) {
    throw new SigningServiceUnavailableError("Completed activity carried no signed transaction");
  }
  await input.chain.verifySignedTransfer({
    signedTransaction,
    unsignedTransaction,
    signer: input.signer,
  });
  return { signedTransaction };
}

async function checkFeesAndNonce(
  chain: DepositChain,
  transfer: { nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  signer: string,
): Promise<void> {
  const quote = await chain.quoteFees();
  if (
    transfer.maxFeePerGas > quote.maxFeePerGas * MAX_FEE_MULTIPLE ||
    transfer.maxPriorityFeePerGas > quote.maxPriorityFeePerGas * MAX_FEE_MULTIPLE
  ) {
    throw new DepositFeeTooHighError();
  }
  if (transfer.nonce > (await chain.pendingNonce(signer))) {
    throw new DepositNonceError();
  }
}
```

Rewrite `confirmDeposit` to call `checkStampedTransfer({ chain, subOrganizationId: account.subOrganizationId, signer: account.address, recipient: wallet.address, token: "AUSD", amount: context.baseUnits, signed })`,
then keep its recorded check, broadcast, forget and `saveDeposit` as they are. Keep the comments
that explain each rule: move them with the code.

The deposit test's fake `pendingNonce` asserts `address === MASTER`, which still holds for
deposits (the signer is the master).

6. **`confirmTransfer(userId, request, signed)`:**

```ts
    async confirmTransfer(userId: string, request: TransferRequest, signed: SignedActivityRequest): Promise<{ txHash: string }> {
      const { chain, account, source, target } = await transferContext(userId, request);
      const { signedTransaction } = await checkStampedTransfer({
        chain,
        subOrganizationId: account.subOrganizationId,
        signer: source.address,
        recipient: target.address,
        token: request.token,
        amount: request.amount,
        signed,
      });
      if (await deps.agentWallets.transferRecorded(chain.transactionHash(signedTransaction))) {
        throw new TransferAlreadyRecordedError();
      }
      const txHash = await chain.broadcast(signedTransaction);
      chain.forgetBalance(source.address);
      chain.forgetBalance(target.address);
      await deps.agentWallets.saveTransfer({
        userId,
        fromWalletId: source.walletId,
        toWalletId: target.walletId,
        token: request.token === "AUSD" ? "ausd" : "mon",
        amount: request.amount,
        txHash,
      });
      return { txHash };
    },
```

`transferContext` reads the source balance again at confirm, so the amount re-check covers a
balance that dropped in between. This is intended.

Import `fundingShortfall` and `WalletUnderfundedError` from `../../studio/create.js`, and the
new errors from `../domain/deposit.js`.

- [ ] **Step 6: Implement the adapters**

In `turnkey-activities.ts:76`, change `walletName: input.handle` to `walletName: input.name`. In
`packages/infrastructure/test/turnkey-activities.test.ts:83`, change the call to pass
`name: "Agent wallet 1"` and the expectation to `walletName: "Agent wallet 1"`.

In `deposit-tx.ts`, add:

```ts
/** A plain MON transfer: empty calldata, `amount` wei to `to`, the same fee and nonce rules. */
export async function buildNativeTransferTx(input: {
  rpc: Rpc;
  chainId: number;
  from: string;
  to: string;
  amount: bigint;
}): Promise<string> {
  const [nonce, fees] = await Promise.all([
    pendingNonce(input.rpc, input.from),
    quoteFees(input.rpc),
  ]);
  let estimate: bigint;
  try {
    estimate = quantity(
      await input.rpc.call("eth_estimateGas", [
        { from: input.from, to: input.to, value: `0x${input.amount.toString(16)}` },
      ]),
      "eth_estimateGas",
    );
  } catch (cause) {
    throw new DepositNotSendableError({ cause });
  }
  return serializeTransaction({
    type: "eip1559",
    chainId: input.chainId,
    nonce,
    to: input.to as Hex,
    value: input.amount,
    data: "0x",
    gas: (estimate * 12n + 9n) / 10n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
}

/** Null unless an unsigned, canonically encoded EIP-1559 transfer with empty calldata. */
export function inspectNativeTransfer(
  unsignedTransaction: string,
): NativeTransferInspection | null {
  let parsed: ReturnType<typeof parseTransaction>;
  try {
    parsed = parseTransaction(unsignedTransaction as Hex);
  } catch {
    return null;
  }
  if (parsed.type !== "eip1559" || parsed.r !== undefined || !parsed.to) return null;
  if (serializeTransaction(parsed).toLowerCase() !== unsignedTransaction.toLowerCase()) return null;
  if (parsed.accessList && parsed.accessList.length > 0) return null;
  if (parsed.data && parsed.data !== "0x") return null;
  if (
    parsed.chainId === undefined ||
    parsed.nonce === undefined ||
    parsed.gas === undefined ||
    parsed.maxFeePerGas === undefined ||
    parsed.maxPriorityFeePerGas === undefined
  ) {
    return null;
  }
  return {
    chainId: parsed.chainId,
    nonce: parsed.nonce,
    to: parsed.to,
    value: parsed.value ?? 0n,
    gas: parsed.gas,
    maxFeePerGas: parsed.maxFeePerGas,
    maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
  };
}
```

In `createAusdDepositChain`'s returned object, add:

```ts
    prepareNativeTransfer: ({ from, to, amount }) => buildNativeTransferTx({ rpc, chainId, from, to, amount }),
    inspectNativeTransfer,
```

`forgetBalance` must now forget the MON reading too, not just AUSD. Today it calls
`config.balances.forget(address)` on the AUSD reader. The custody `balances` reader (Task 4,
Step 6) caches nothing, so no change is needed there. Note that in a code comment.

Add to the infrastructure deposit-tx test (copy the style of its `inspectTransfer` tests):

```ts
test("inspectNativeTransfer reads a plain transfer it serialized", () => {
  const raw = serializeTransaction({
    type: "eip1559",
    chainId: 10143,
    nonce: 1,
    to: AGENT,
    value: 5n,
    data: "0x",
    gas: 21_000n,
    maxFeePerGas: 3n,
    maxPriorityFeePerGas: 1n,
  });
  assert.equal(inspectNativeTransfer(raw)?.value, 5n);
});

test("inspectNativeTransfer refuses calldata", () => {
  const raw = serializeTransaction({
    type: "eip1559",
    chainId: 10143,
    nonce: 1,
    to: AGENT,
    value: 0n,
    data: "0xa9059cbb",
    gas: 21_000n,
    maxFeePerGas: 3n,
    maxPriorityFeePerGas: 1n,
  });
  assert.equal(inspectNativeTransfer(raw), null);
});
```

- [ ] **Step 7: Run the tests**

Run: `npm run build:shared >/dev/null && node --import tsx --test packages/core/test/custody-transfer.test.ts packages/core/test/custody-agent-wallet.test.ts packages/core/test/custody-deposit.test.ts packages/infrastructure/test/turnkey-activities.test.ts packages/infrastructure/test/deposit-tx.test.ts`
Expected: PASS. The deposit tests still pass unchanged, which proves the extraction.

- [ ] **Step 8: Commit**

```bash
git commit -m "Custody: master↔agent transfers of AUSD or MON with the deposit's checks; agent wallets without a handle; policies wait for the minimums

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/core/src/features/wallets packages/core/src/index.ts packages/core/test/custody-transfer.test.ts packages/core/test/custody-agent-wallet.test.ts packages/infrastructure/src/turnkey/turnkey-activities.ts packages/infrastructure/src/chain/deposit-tx.ts packages/infrastructure/test/turnkey-activities.test.ts packages/infrastructure/test/deposit-tx.test.ts
```

---

### Task 4: API (the wallet ceremony without a handle, the funding error, `GET /wallets`, transfers, the new drafts)

**Files:**

- Modify: `packages/core/src/features/studio/access.ts:46-60` (the `createDraft` signature) and its `createStudioAccess`
- Modify: `packages/infrastructure/src/studio/directory.ts:221-350` (`createDraft` rewritten; `adoptedDraft` deleted)
- Modify: `packages/api-schema/src/studio.ts:302-313` (`draftCreateSchema`), plus the new `transferRequestSchema`
- Modify: `workers/api/src/routes/signing.ts:458-500`
- Modify: `workers/api/src/http/error-handler.ts:97` (beside `AgentWalletNotFoundError`)
- Modify: `workers/api/src/routes/studio.ts` (custody type at 103-111; `pilotStatus`; `custodyFailure`; routes)
- Modify: `workers/api/src/container.ts:205-219` (pass `balances` to `createCustodyService`)
- Test: `workers/api/test/signing.test.ts`, `workers/api/test/studio-drafts-route.test.ts`, `workers/api/test/studio-transfers-route.test.ts` (new), `packages/infrastructure/test/studio-draft.test.ts`

- [ ] **Step 1: Write the failing route tests**

Rewrite `workers/api/test/studio-drafts-route.test.ts` for the new body. Keep its `app()` harness
(lines 31-110); drop `RUN`, `preparePreview` and `previewRunId`:

```ts
const body = {
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: { ...DEFAULT_BRIEF },
  caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 },
  walletId: "wal-agent",
};
```

The harness's `services` gain:

```ts
custody: () => ({
  ...noopDeposit,
  walletBalance: async () => ({ monWei: mon, ausdMicro: ausd }),
} as never),
```

`mon` and `ausd` are `app()` options, defaulting to the minimums. `directory.createDraft` records
`input.config`, `input.profile` and `input.walletId`.

Tests:

- `"a draft is created with the wallet and answers 201 with its product id"`: status 201,
  `productId === DRAFT`, and the directory got `walletId: "wal-agent"`.
- `"a draft below either minimum is 409 WALLET_UNDERFUNDED with the balances"`: `mon: 0n`, the
  status is 409, and `json.error === "WALLET_UNDERFUNDED"` with `json.detail.minMonWei === "500000000000000000"`.
- `"a previewRunId is refused as unknown"`: body plus `previewRunId`, 400.
- `"a missing voice is 400 INVALID_INPUT"`.
- `"no entry rule is 400 INVALID_BRIEF naming entersWhen"`.
- `"the directory's WALLET_ASSIGNED, POLICIES_MISSING and HANDLE_TAKEN are 409"`: three tests
  through the `refuse` option.
- `"the directory's WALLET_NOT_FOUND is 404"`.

Create `workers/api/test/studio-transfers-route.test.ts` with the same harness and a fake custody
that records calls to `prepareTransfer`, `confirmTransfer` and `listWallets`:

- `"GET /wallets answers master and agents with base units as strings"`.
- `"a transfer prepare passes the amount in base units: 1.5 AUSD is 1500000"`.
- `"a transfer of MON passes wei: 0.5 is 500000000000000000"`.
- `"an amount with more decimals than the token has is 400"`: `"0.0000001"` AUSD.
- `"InsufficientFundsError is 409 INSUFFICIENT_FUNDS"`.
- `"InvalidTransferError is 400 INVALID_TRANSFER"`.
- `"TransferAlreadyRecordedError is 409 TRANSFER_ALREADY_RECORDED"`.

In `workers/api/test/signing.test.ts`, change the wallet prepare and confirm tests to send `{}` and
`{ signed }`. Add `"a handle in the wallet prepare body is refused"` (400, because the body must be
empty) and `"WalletUnderfundedError on policies prepare is 409 wallet_underfunded with detail"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build:shared >/dev/null && node --import tsx --test workers/api/test/studio-drafts-route.test.ts workers/api/test/studio-transfers-route.test.ts workers/api/test/signing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Schemas**

In `packages/api-schema/src/studio.ts`, replace lines 302-313:

```ts
/** `POST /v1/studio/drafts` (studio-create-simplified-v1 §4.1). Rules are core's (`prepareDraft`). */
export const draftCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    voice: z.enum(["analyst", "contrarian", "trash_talker", "deadpan", "hype", "professor"]),
    avatar: z
      .object({
        accent: z.enum(["lime", "cyan", "amber", "orange", "magenta", "violet", "blue"]),
        pattern: z.number().int(),
      })
      .strict(),
    sources: z
      .object({
        web: z
          .object({
            mode: z.enum(["anywhere", "prefer", "only"]),
            sites: z.array(z.string().max(253)).max(20),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    brief: z
      .object({
        thesis: z.string().max(4000),
        entersWhen: z.array(z.string().max(1000)).max(50),
        exitsWhen: z.array(z.string().max(1000)).max(50),
        never: z.array(z.string().max(1000)).max(50),
      })
      .strict(),
    caps: z
      .object({ perTradeAusd: z.number(), perDayAusd: z.number(), maxLeverage: z.number() })
      .strict(),
    walletId: z.string().min(1).max(128),
  })
  .strict();
export type DraftCreateDto = z.infer<typeof draftCreateSchema>;

/** `POST /v1/studio/wallets/transfers/prepare|confirm`: a decimal amount of one token. */
export const transferRequestSchema = z
  .object({
    from: z.string().min(1).max(128),
    to: z.string().min(1).max(128),
    token: z.enum(["AUSD", "MON"]),
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .max(40),
  })
  .strict();
export type TransferRequestDto = z.infer<typeof transferRequestSchema>;
```

`draftCreateSchema` no longer extends `previewRunRequestSchema`, which stays for the preview routes.

- [ ] **Step 4: The directory's new `createDraft`**

In `packages/core/src/features/studio/access.ts`, change `StudioDirectory.createDraft` to:

```ts
  /**
   * Creates the private draft with its wallet (studio-create-simplified-v1 §4.1), in one transaction:
   * locks the workspace; refuses HANDLE_TAKEN; locks the wallet (WALLET_NOT_FOUND unless it is the
   * caller's agent wallet, WALLET_ASSIGNED when linked, POLICIES_MISSING without approved policies);
   * runs `admit`; writes the agent (`draft`), its profile, handle, runtime row and product row, and
   * links the wallet. A retry with the same wallet, handle and name answers the same draft without `admit`.
   */
  createDraft(
    access: StudioAccess,
    userId: string,
    input: {
      name: string;
      handle: string;
      config: AgentConfig;
      profile: { accent: Accent; avatarPattern: number; voice: string };
      walletId: string;
    },
    admit?: CreateAdmission,
  ): Promise<{ productId: string; scope: Scope }>;
```

In `packages/infrastructure/src/studio/directory.ts`, replace `createDraft` (lines 221-349) and
delete `adoptedDraft` (lines 350-388). Write it from `createAgent`'s wallet block (lines 167-188)
and the old draft's inserts:

```ts
  async createDraft(
    access: StudioAccess,
    userId: string,
    input: {
      name: string;
      handle: string;
      config: AgentConfig;
      profile: { accent: Accent; avatarPattern: number; voice: string };
      walletId: string;
    },
    admit?: CreateAdmission,
  ): Promise<{ productId: string; scope: Scope }> {
    try {
      return await this.transaction(async (client) => {
        const allowed = await client.query(
          `SELECT w.id FROM identity.workspaces w
          JOIN pickler.research_access a ON a.user_id=w.owner_user_id
          WHERE w.id=$1 AND w.owner_user_id=$2 AND w.is_active AND a.enabled FOR NO KEY UPDATE OF w,a`,
          [access.workspaceId, userId],
        );
        if (!allowed.rows.length) {
          throw new AccessDeniedError("Research access revoked");
        }
        const key = `draft:${input.walletId}`;
        const request = JSON.stringify({ name: input.name, handle: input.handle, walletId: input.walletId });
        const replay = await client.query(
          `SELECT product_agent_id::text AS "productId", runtime_agent_id AS "agentId", request=$3::jsonb AS matches
          FROM pickler.product_agents WHERE workspace_id=$1 AND request_key=$2`,
          [access.workspaceId, key, request],
        );
        if (replay.rows[0]) {
          if (!replay.rows[0].matches) {
            throw new PilotError("CONFLICT", DIFFERENT_TERMS);
          }
          return { productId: replay.rows[0].productId, scope: { tenantId: access.tenantId, agentId: replay.rows[0].agentId } };
        }
        const available = await client.query("SELECT identity.handle_available($1) AS available", [input.handle]);
        if (!available.rows[0].available) {
          throw new PilotError("HANDLE_TAKEN", "Handle unavailable");
        }
        const owned = await client.query<{ approvedPolicyIds: string[] | null; linked: boolean }>(
          `SELECT w.approved_policy_ids AS "approvedPolicyIds",
                  EXISTS (SELECT 1 FROM wallets.agent_wallets l WHERE l.wallet_id = w.wallet_id) AS linked
          FROM wallets.wallets w WHERE w.wallet_id=$1 AND w.user_id=$2 AND w.kind='agent' FOR UPDATE`,
          [input.walletId, userId],
        );
        const wallet = owned.rows[0];
        if (!wallet) {
          throw new PilotError("WALLET_NOT_FOUND", "Wallet not found");
        }
        if (wallet.linked) {
          throw new PilotError("WALLET_ASSIGNED", "That wallet already belongs to an agent");
        }
        if (!wallet.approvedPolicyIds || wallet.approvedPolicyIds.length < MIN_AGENT_WALLET_POLICIES) {
          throw new PilotError("POLICIES_MISSING", "Sign its caps first");
        }
        await admit?.();
        const id = randomUUID();
        await client.query(
          "INSERT INTO agents.agents (id, workspace_id, name, handle, status, created_by) VALUES ($1,$2,$3,$4,'draft',$5)",
          [id, access.workspaceId, input.name, input.handle, userId],
        );
        await client.query(
          `INSERT INTO agents.agent_profiles (agent_id, beat, accent, avatar_pattern, venue, voice)
           VALUES ($1, 'crypto', $2, $3, 'perps', $4)`,
          [id, input.profile.accent, input.profile.avatarPattern, input.profile.voice],
        );
        await client.query("INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1,$2,$3)", [
          id,
          input.walletId,
          wallet.approvedPolicyIds,
        ]);
        await client.query("INSERT INTO identity.handles (handle,agent_id) VALUES ($1,$2)", [input.handle, id]);
        await client.query("INSERT INTO pickler.agents (tenant_id,id,config) VALUES ($1,$2,$3::jsonb)", [
          access.tenantId,
          id,
          JSON.stringify(input.config),
        ]);
        await client.query(
          `INSERT INTO pickler.product_agents (product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
          VALUES ($1::uuid,$2,$3,$1::text,$4,$5::jsonb)`,
          [id, access.workspaceId, access.tenantId, key, request],
        );
        return { productId: id, scope: { tenantId: access.tenantId, agentId: id } };
      });
    } catch (error) {
      if (error instanceof PilotError && error.code === "CONFLICT" && error.message !== DIFFERENT_TERMS) {
        throw new PilotError("HANDLE_TAKEN", "Handle unavailable");
      }
      throw error;
    }
  }
```

Before writing `'perps'` and `'crypto'`, check that `agent_profiles.venue` and `beat` accept them:
`grep -n "venue\|beat" packages/infrastructure/src/persistence/product/agents.ts` and the
`VenueDto` in api-schema. If `perps` is not allowed, use the value the marketplace maps to Perpl;
the marketplace directory shows `venue: "perps"` in `apps/web/src/features/agents/components/leaderboard-page.tsx:23`.

Remove `assertPreviewAdoptable` and `AdoptablePreview` from the import list.

Rewrite `packages/infrastructure/test/studio-draft.test.ts` for the new signature. It is DB-backed;
copy its setup. One test each:

- a draft links the wallet;
- an assigned wallet is WALLET_ASSIGNED;
- no approved policies is POLICIES_MISSING;
- another user's wallet is WALLET_NOT_FOUND;
- a taken handle is HANDLE_TAKEN;
- a retry returns the same `productId` without calling `admit`.

- [ ] **Step 5: Routes**

In `workers/api/src/routes/signing.ts`:

```ts
api.post("/agents/wallet/prepare", async (c) => {
  const user = person(c);
  await emptyBody(c);
  const prepared = await services.custody(c.get("requestId")).prepareAgentWallet(user.id);
  // …the existing/unsigned answer, unchanged
});

api.post("/agents/wallet/confirm", async (c) => {
  const user = person(c);
  const body = await jsonBody(c);
  const wallet = await services
    .custody(c.get("requestId"))
    .confirmAgentWallet(user.id, signedActivity(body));
  // …unchanged answer
});
```

Delete the `handle(body)` helper (lines 181-195) if nothing else uses it; check with
`grep -n "handle(body)" workers/api/src/routes/signing.ts`. Update the ceremony comment
(lines 418-421): the wallet is named "Agent wallet N", not after a handle.

In `workers/api/src/http/error-handler.ts`, after the `AgentWalletNotFoundError` branch:

```ts
if (error instanceof WalletUnderfundedError) {
  return {
    status: 409,
    message: error.message,
    extras: { error: "wallet_underfunded", detail: error.detail },
  };
}
```

If `ErrorExtras.detail` is typed as `string`, widen it to `unknown`. The signing family's envelope
already carries `detail` (see the `profile_exists` branch, line 81). Import
`WalletUnderfundedError` from `@pickler/core`.

In `workers/api/src/routes/studio.ts`:

1. Widen the custody `Pick` (line 109) to
   `"prepareDeposit" | "confirmDeposit" | "prepareTransfer" | "confirmTransfer" | "listWallets" | "walletBalance"`,
   and add to custody (Task 3, Step 5):

```ts
    /** One agent wallet's balances, for the drafts route's second check. */
    async walletBalance(userId: string, walletId: string) {
      const wallet = await deps.agentWallets.findOwnedAgentWallet(userId, walletId);
      if (!wallet) {
        throw new AgentWalletNotFoundError();
      }
      if (!deps.balances) {
        throw new DepositsUnavailableError();
      }
      return deps.balances.read(wallet.address);
    },
```

Add this to Task 3's commit if you do it there. Otherwise include `custody.ts` in this commit. 2. Add to `pilotStatus`: `if (code === "WALLET_NOT_FOUND") return 404;`. The default 409 covers
WALLET_ASSIGNED, POLICIES_MISSING and WALLET_UNDERFUNDED. 3. In `onError`, before the `PilotError` branch:

```ts
if (error instanceof WalletUnderfundedError) {
  return c.json({ error: error.code, detail: error.detail }, 409);
}
```

4. Add to `custodyFailure`:

```ts
if (error instanceof InvalidTransferError) return { code: "INVALID_TRANSFER", status: 400 };
if (error instanceof InsufficientFundsError) return { code: "INSUFFICIENT_FUNDS", status: 409 };
if (error instanceof TransferAlreadyRecordedError)
  return { code: "TRANSFER_ALREADY_RECORDED", status: 409 };
```

5. Replace the drafts route (lines 481-509):

```ts
api.post("/drafts", async (c) => {
  const principal = c.get("principal");
  const current = await access.authorize(principal, true);
  const body = draftCreateSchema.parse(await c.req.json());
  const { config, profile } = prepareDraft(body);
  // The policies were prepared only past the minimums; the money can have moved since.
  const shortfall = fundingShortfall(
    await deposits(c.get("requestId")).walletBalance(principal.id, body.walletId),
  );
  if (shortfall) {
    throw new WalletUnderfundedError(shortfall);
  }
  let created;
  try {
    created = await services.directory.createDraft(
      current,
      principal.id,
      { name: body.name, handle: body.handle, config, profile, walletId: body.walletId },
      fundingLock(current, "draft"),
    );
  } catch (error) {
    if (error instanceof PilotError && error.code === "DRAFT_LIMIT") {
      return c.json({ error: error.code, message: error.message }, pilotStatus(error.code));
    }
    throw error;
  }
  return c.json(
    {
      productId: created.productId,
      agent: agentResponseSchema.parse(await repo.agent(created.scope)),
    },
    201,
  );
});
```

6. Add the wallet routes:

```ts
/** Decimal → base units, exactly; more decimals than the token has is 400. */
function baseUnitsOf(token: "AUSD" | "MON", amount: string): bigint {
  const decimals = token === "AUSD" ? 6 : 18;
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new InvalidTransferError(`At most ${decimals} decimals`);
  }
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

const stringBalances = (balance: { monWei: bigint | null; ausdMicro: bigint | null }) => ({
  monWei: balance.monWei === null ? null : balance.monWei.toString(),
  ausdMicro: balance.ausdMicro === null ? null : balance.ausdMicro.toString(),
});

api.get("/wallets", async (c) => {
  const principal = c.get("principal");
  await access.authorize(principal);
  const listed = await deposits(c.get("requestId")).listWallets(principal.id);
  return c.json({
    master: { address: listed.master.address, ...stringBalances(listed.master) },
    agents: listed.agents.map((wallet) => ({
      walletId: wallet.walletId,
      address: wallet.address,
      agentId: wallet.agentId,
      agentName: wallet.agentName,
      caps: wallet.caps,
      policiesApproved: wallet.policiesApproved,
      ...stringBalances(wallet),
    })),
    readAt: listed.readAt,
  });
});

api.post("/wallets/transfers/prepare", async (c) => {
  const principal = c.get("principal");
  await access.authorize(principal, true);
  const body = transferRequestSchema.parse(await c.req.json());
  const unsigned = await deposits(c.get("requestId")).prepareTransfer(principal.id, {
    from: body.from,
    to: body.to,
    token: body.token,
    amount: baseUnitsOf(body.token, body.amount),
  });
  return c.json({
    url: unsigned.url,
    body: unsigned.body,
    timestampMs: unsigned.timestampMs,
    organizationId: unsigned.organizationId,
  });
});

api.post("/wallets/transfers/confirm", async (c) => {
  const principal = c.get("principal");
  await access.authorize(principal, true);
  const raw = await c.req.json();
  const body = transferRequestSchema.extend({ signed: signedActivitySchema }).strict().parse(raw);
  const { txHash } = await deposits(c.get("requestId")).confirmTransfer(
    principal.id,
    {
      from: body.from,
      to: body.to,
      token: body.token,
      amount: baseUnitsOf(body.token, body.amount),
    },
    body.signed,
  );
  return c.json({ txHash });
});
```

`transferRequestSchema` is a `ZodObject` with `.strict()` applied. If `.extend` is not
available on it, define `transferConfirmSchema` in api-schema next to it with `signed` typed as
`z.unknown()`, and parse `signed` with the route's `signedActivitySchema`.

7. Import `prepareDraft`, `fundingShortfall`, `WalletUnderfundedError`, `InvalidTransferError`,
   `InsufficientFundsError` and `TransferAlreadyRecordedError` from `@pickler/core`, and
   `transferRequestSchema` from `@pickler/api-schema`. Remove `preparePreview` from the imports if
   only the old drafts route used it; the preview routes still use it, so check with grep.

In `workers/api/src/container.ts`, inside `createCustodyService({...})` (line 206), add:

```ts
        ...(chainId === null
          ? {}
          : {
              balances: walletBalances(createBalanceReader({ chainId, ...endpoint })),
            }),
```

with this helper in `container.ts`:

```ts
/** The custody service's balances: base units, null where a read failed. Nothing is cached. */
function walletBalances(reader: ReturnType<typeof createBalanceReader>): WalletBalanceReader {
  return {
    async read(address) {
      const read = await reader.read(address);
      return {
        monWei: read.native.raw === null ? null : BigInt(read.native.raw),
        ausdMicro: read.token.raw === null ? null : BigInt(read.token.raw),
      };
    },
  };
}
```

AUSD has 6 decimals on Monad (`@pickler/chain` `AUSD[chainId].decimals`), so its base units are
micro-AUSD. Assert that in the helper:

```ts
if (AUSD[chainId].decimals !== 6) {
  throw new Error("AUSD base units are assumed to be micro-AUSD");
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run build:shared >/dev/null && node --import tsx --test workers/api/test/*.test.ts packages/infrastructure/test/studio-draft.test.ts`
Expected: PASS, except `studio-draft-route.test.ts` (the model-drafting route), which Task 12
deletes. If it fails now only because of the changed imports, leave it until Task 12.

Run: `npm run typecheck`
Expected: PASS. If `apps/web` fails on `createDraft`'s body, that is Task 5; run
`npm run typecheck --workspace=@pickler/api` and the core, infrastructure and api-schema workspaces
instead.

- [ ] **Step 7: Commit**

```bash
git commit -m "API: agent wallets without a handle, the funding check, GET /wallets, transfers, and drafts created with their wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/api-schema/src/studio.ts packages/core/src/features/studio/access.ts packages/core/src/features/wallets/application/custody.ts packages/infrastructure/src/studio/directory.ts packages/infrastructure/test/studio-draft.test.ts workers/api/src workers/api/test/signing.test.ts workers/api/test/studio-drafts-route.test.ts workers/api/test/studio-transfers-route.test.ts
```

---

### Task 5: The web data layer (`api.ts`) and the pure create model

**Files:**

- Modify: `apps/web/src/features/studio/api.ts:94-134, 276-305`
- Create: `apps/web/src/features/studio/new-agent/model.ts`
- Test: `apps/web/test/studio-new-agent.test.ts`

- [ ] **Step 1: Write the failing model tests**

```ts
// apps/web/test/studio-new-agent.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AVATAR_PATTERNS,
  MIN_START,
  STARTER_CAPS,
  VOICES,
  canCreate,
  createLabel,
  deriveHandle,
  emptyForm,
  footNote,
  funded,
  handleState,
  parseAmount,
  patternCells,
  toDraftRequest,
  transferLabel,
  walletTag,
  type NewAgentForm,
  type WalletView,
} from "../src/features/studio/new-agent/model";

/* One behaviour per test: these are the rules the create screen is. */

const filled = (patch: Partial<NewAgentForm> = {}): NewAgentForm => ({
  ...emptyForm(),
  name: "Halftime",
  voice: "analyst",
  ...patch,
});
const wallet = (patch: Partial<WalletView> = {}): WalletView => ({
  walletId: "wal",
  address: "0x91be",
  ausdMicro: 10_000_000n,
  monWei: 500_000_000_000_000_000n,
  ...patch,
});

test("the handle follows the name", () => {
  assert.equal(deriveHandle("Half Time!"), "halftime");
});

test("an edited handle wins over the name's", () => {
  assert.equal(deriveHandle("Halftime", "ht_bot"), "ht_bot");
});

test("no name is 'Name it to create'", () => {
  assert.equal(createLabel(emptyForm(), handleState("", null), null), "Name it to create");
});

test("a taken handle says so", () => {
  assert.equal(createLabel(filled(), "taken", wallet()), "@halftime is taken");
});

test("no voice is 'Pick a voice to create'", () => {
  assert.equal(createLabel(filled({ voice: null }), "free", wallet()), "Pick a voice to create");
});

test("no wallet is 'Create its wallet first'", () => {
  assert.equal(createLabel(filled(), "free", null), "Create its wallet first");
});

test("a wallet below either minimum is 'Deposit to create'", () => {
  assert.equal(createLabel(filled(), "free", wallet({ monWei: 0n })), "Deposit to create");
});

test("everything there is 'Create {name}'", () => {
  assert.equal(createLabel(filled(), "free", wallet()), "Create Halftime");
});

test("create opens only with a free handle, a voice and a funded wallet", () => {
  assert.equal(canCreate(filled(), "free", wallet()), true);
  assert.equal(canCreate(filled(), "free", wallet({ ausdMicro: 9_999_999n })), false);
});

test("an unread balance is not funded", () => {
  assert.equal(funded(wallet({ ausdMicro: null })), false);
});

test("the footnote points at the wallet until it is funded", () => {
  assert.equal(footNote(null), "CREATE ITS WALLET FIRST →");
  assert.equal(footNote(wallet({ monWei: 0n })), "FUND ITS WALLET TO CREATE →");
  assert.equal(footNote(wallet()), "ONE PASSKEY");
});

test("the wallet tag: step 0, empty, funded", () => {
  assert.equal(walletTag(null), "STEP 0 · CREATE IT");
  assert.equal(walletTag(wallet({ ausdMicro: 0n })), "CREATED · EMPTY");
  assert.equal(walletTag(wallet()), "FUNDED");
});

test("the request carries the caps, the avatar, the web off as null and the wallet", () => {
  const request = toDraftRequest(filled(), "wal");
  assert.deepEqual(request.caps, { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 });
  assert.deepEqual(request.avatar, { accent: "lime", pattern: 0 });
  assert.equal(request.sources.web, null);
  assert.equal(request.walletId, "wal");
});

test("the web on sends its mode and sites", () => {
  const request = toDraftRequest(filled({ webOn: true, webMode: "only", sites: ["x.com"] }), "wal");
  assert.deepEqual(request.sources.web, { mode: "only", sites: ["x.com"] });
});

test("an amount is parsed to base units: 1.5 AUSD", () => {
  assert.equal(parseAmount("1.5", "AUSD"), 1_500_000n);
});

test("an amount with too many decimals is not an amount", () => {
  assert.equal(parseAmount("0.0000001", "AUSD"), null);
});

test("a transfer label names the token and refuses more than the source holds", () => {
  assert.equal(
    transferLabel({
      amount: "5",
      token: "MON",
      toAgent: true,
      held: 10n ** 18n,
      agentName: "Halftime",
    }),
    "More MON than the master wallet holds",
  );
  assert.equal(
    transferLabel({
      amount: "0.5",
      token: "MON",
      toAgent: true,
      held: 10n ** 18n,
      agentName: "Halftime",
    }),
    "Send 0.5 MON to Halftime",
  );
});

test("a pattern is sixteen cells", () => {
  assert.equal(patternCells(0).length, 16);
});

test("the copies match core's: six voices, six patterns, the starter caps, the minimums", async () => {
  const core = await import("@pickler/core");
  assert.deepEqual(
    VOICES.map((voice) => voice.key),
    core.VOICES.map((voice) => voice.key),
  );
  assert.deepEqual([...AVATAR_PATTERNS], [...core.AVATAR_PATTERNS]);
  assert.deepEqual(STARTER_CAPS, { ...core.STARTER_CAPS });
  assert.equal(MIN_START.ausdMicro, core.MIN_START_MICRO_AUSD);
  assert.equal(MIN_START.monWei, core.MIN_START_MON_WEI);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --import tsx --test apps/web/test/studio-new-agent.test.ts`
Expected: FAIL (the module is missing).

- [ ] **Step 3: Write `model.ts`**

```ts
// apps/web/src/features/studio/new-agent/model.ts
/**
 * The create screen's rules (docs/specs/studio-create-simplified-v1.md, the "Pickler Studio Empty
 * v5" canvas): the handle a name becomes, when "Create" opens and what it says, the wallet's
 * minimums and tag, the request, and the transfer form. Pure, no React and no transport, so each
 * rule is pinned in `apps/web/test/studio-new-agent.test.ts`.
 *
 * `VOICES`, `AVATAR_PATTERNS`, `STARTER_CAPS`, `MIN_START` and `DEFAULT_BRIEF` are literal copies
 * of core's (`packages/core/src/features/studio/create.ts`): this module is required by node:test
 * from CommonJS, where an "import"-only package cannot be loaded statically. The test pins each
 * copy through a dynamic import.
 */
export type VoiceKey = "analyst" | "contrarian" | "trash_talker" | "deadpan" | "hype" | "professor";
export type Accent = "lime" | "cyan" | "amber" | "orange" | "magenta" | "violet" | "blue";
export type WebMode = "anywhere" | "prefer" | "only";
export type Token = "AUSD" | "MON";

export const VOICES: readonly { key: VoiceKey; name: string; tint: Accent; sample: string }[] = [
  {
    key: "analyst",
    name: "Analyst",
    tint: "blue",
    sample: "Long BTC at 3×, 25 AUSD. Headline first, price second. Out by the close.",
  },
  {
    key: "contrarian",
    name: "Contrarian",
    tint: "orange",
    sample: "Everyone is long and paying for it. That is the whole reason I am short.",
  },
  {
    key: "trash_talker",
    name: "Trash talker",
    tint: "magenta",
    sample: "You saw the headline a minute after me. I was already filled.",
  },
  {
    key: "deadpan",
    name: "Deadpan",
    tint: "cyan",
    sample: "Long BTC. 25 AUSD. 3×. That is the post.",
  },
  { key: "hype", name: "Hype", tint: "lime", sample: "WE ARE LONG. Full clip. Let it run." },
  {
    key: "professor",
    name: "Professor",
    tint: "amber",
    sample: "Funding at 0.09% with OI up 22% is a crowded trade by any definition. Fading it.",
  },
];

export const ACCENT_OPTIONS: readonly Accent[] = [
  "lime",
  "cyan",
  "amber",
  "orange",
  "magenta",
  "blue",
  "violet",
];

export const AVATAR_PATTERNS = [
  "1001011001101001",
  "1111100110011111",
  "0110100110010110",
  "1010010110100101",
  "1100110000110011",
  "0000011001100000",
] as const;

export const STARTER_CAPS = { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 } as const;
export const MIN_START = { ausdMicro: 10_000_000n, monWei: 500_000_000_000_000_000n } as const;
export const MAX_SITES = 20;

export const DEFAULT_BRIEF = {
  thesis:
    "Headlines move BTC and ETH before the order book does. The edge is the 30 to 90 seconds between a credible headline and the first big print.",
  enters:
    "Two of my sources carry the same headline within 60s\nPrice has moved less than 0.3% since the headline\nFunding is not already leaning my way by more than 0.05%",
  exits:
    "+2% take profit or −1% stop, whichever comes first\nFour hours after entry, no matter what\nA second headline contradicts the first",
  never:
    "Trade a headline from a single source\nHold through a funding print\nAdd to a losing position",
} as const;

export interface NewAgentForm {
  name: string;
  /** "" follows the name. */
  handle: string;
  voice: VoiceKey | null;
  accent: Accent;
  pattern: number;
  webOn: boolean;
  webMode: WebMode;
  sites: string[];
  thesis: string;
  enters: string;
  exits: string;
  never: string;
  perTrade: number;
  perDay: number;
  leverage: number;
}

export const emptyForm = (): NewAgentForm => ({
  name: "",
  handle: "",
  voice: null,
  accent: "lime",
  pattern: 0,
  webOn: false,
  webMode: "anywhere",
  sites: [],
  thesis: DEFAULT_BRIEF.thesis,
  enters: DEFAULT_BRIEF.enters,
  exits: DEFAULT_BRIEF.exits,
  never: DEFAULT_BRIEF.never,
  perTrade: STARTER_CAPS.perTradeAusd,
  perDay: STARTER_CAPS.perDayAusd,
  leverage: STARTER_CAPS.maxLeverage,
});

/** The agent's wallet as the screen knows it, in base units; null balances are unread. */
export interface WalletView {
  walletId: string;
  address: string;
  ausdMicro: bigint | null;
  monWei: bigint | null;
}

const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 15);

export const deriveHandle = (name: string, edited = ""): string =>
  edited.trim() ? slug(edited) : slug(name);

export type HandleState = "empty" | "invalid" | "checking" | "free" | "taken" | "failed";

export function handleState(handle: string, available: boolean | null | "failed"): HandleState {
  if (!handle) return "empty";
  if (!/^[a-z0-9_]{3,15}$/.test(handle)) return "invalid";
  if (available === null) return "checking";
  if (available === "failed") return "failed";
  return available ? "free" : "taken";
}

export const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const funded = (wallet: WalletView | null): boolean =>
  wallet !== null &&
  wallet.ausdMicro !== null &&
  wallet.monWei !== null &&
  wallet.ausdMicro >= MIN_START.ausdMicro &&
  wallet.monWei >= MIN_START.monWei;

export function createLabel(
  form: NewAgentForm,
  handle: HandleState,
  wallet: WalletView | null,
): string {
  const derived = deriveHandle(form.name, form.handle);
  if (!form.name.trim()) return "Name it to create";
  if (handle === "taken") return `@${derived} is taken`;
  if (handle === "invalid" || handle === "empty")
    return `@${derived || "handle"} can't be a handle`;
  if (handle === "checking") return `Checking @${derived}…`;
  if (handle === "failed") return `Couldn't check @${derived} · try again`;
  if (!form.voice) return "Pick a voice to create";
  if (lines(form.enters).length === 0) return "Write an entry rule to create";
  if (form.webOn && form.webMode === "only" && form.sites.length === 0)
    return "Name a site for “Only”";
  if (!wallet) return "Create its wallet first";
  if (!funded(wallet)) return "Deposit to create";
  return `Create ${form.name.trim()}`;
}

export const canCreate = (
  form: NewAgentForm,
  handle: HandleState,
  wallet: WalletView | null,
): boolean => createLabel(form, handle, wallet) === `Create ${form.name.trim()}`;

export function footNote(wallet: WalletView | null): string {
  if (!wallet) return "CREATE ITS WALLET FIRST →";
  if (!funded(wallet)) return "FUND ITS WALLET TO CREATE →";
  return "ONE PASSKEY";
}

export function walletTag(wallet: WalletView | null): string {
  if (!wallet) return "STEP 0 · CREATE IT";
  return funded(wallet) ? "FUNDED" : "CREATED · EMPTY";
}

/** What `POST /v1/studio/drafts` is sent. */
export function toDraftRequest(form: NewAgentForm, walletId: string) {
  return {
    name: form.name.trim(),
    handle: deriveHandle(form.name, form.handle),
    voice: form.voice ?? "analyst",
    avatar: { accent: form.accent, pattern: form.pattern },
    sources: { web: form.webOn ? { mode: form.webMode, sites: [...form.sites] } : null },
    brief: {
      thesis: form.thesis.trim(),
      entersWhen: lines(form.enters),
      exitsWhen: lines(form.exits),
      never: lines(form.never),
    },
    caps: { perTradeAusd: form.perTrade, perDayAusd: form.perDay, maxLeverage: form.leverage },
    walletId,
  };
}

const DECIMALS: Record<Token, number> = { AUSD: 6, MON: 18 };

/** A decimal amount in base units, or null when it is not a positive amount the token can hold. */
export function parseAmount(text: string, token: Token): bigint | null {
  const value = text.trim();
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > DECIMALS[token]) return null;
  const units =
    BigInt(whole!) * 10n ** BigInt(DECIMALS[token]) +
    BigInt(fraction.padEnd(DECIMALS[token], "0") || "0");
  return units > 0n ? units : null;
}

/** Base units as a short decimal: 1500000 AUSD-micro → "1.5". */
export function formatUnits(units: bigint | null, token: Token): string {
  if (units === null) return "—";
  const scale = 10n ** BigInt(DECIMALS[token]);
  const whole = units / scale;
  const fraction = (units % scale)
    .toString()
    .padStart(DECIMALS[token], "0")
    .replace(/0+$/, "")
    .slice(0, 4);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function transferLabel(input: {
  amount: string;
  token: Token;
  toAgent: boolean;
  held: bigint | null;
  agentName: string;
}): string {
  const units = parseAmount(input.amount, input.token);
  if (units === null) return "Enter an amount";
  if (input.held === null || units > input.held) {
    return `More ${input.token} than ${input.toAgent ? "the master wallet" : input.agentName} holds`;
  }
  return input.toAgent
    ? `Send ${input.amount} ${input.token} to ${input.agentName}`
    : `Pull ${input.amount} ${input.token} back`;
}

export const patternCells = (index: number): boolean[] =>
  (AVATAR_PATTERNS[index] ?? AVATAR_PATTERNS[0]).split("").map((cell) => cell === "1");

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** What a typed site becomes: a bare host, or null when it is not one. */
export function siteHost(text: string): string | null {
  const host = text
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return HOST.test(host) ? host : null;
}

export function siteNote(form: NewAgentForm, draft: string): { text: string; bad: boolean } {
  if (draft.trim() && !siteHost(draft))
    return { text: "BARE HOSTNAMES ONLY · NO HTTPS, NO PATHS", bad: true };
  if (draft.trim() && form.sites.includes(siteHost(draft)!))
    return { text: "ALREADY LISTED", bad: true };
  if (form.sites.length >= MAX_SITES)
    return { text: `${MAX_SITES} SITES IS THE LIMIT`, bad: false };
  if (form.webMode === "only" && form.sites.length === 0)
    return { text: "“ONLY” NEEDS AT LEAST ONE SITE", bad: true };
  return { text: `${form.sites.length} OF ${MAX_SITES} · ENTER TO ADD`, bad: false };
}
```

- [ ] **Step 4: Update `api.ts`**

In `apps/web/src/features/studio/api.ts`:

- Replace `createDraft`'s body type (line 109) with
  `ReturnType<typeof import("./new-agent/model").toDraftRequest>`, or import `DraftCreateDto` as a
  type from `@pickler/api-schema` (type imports are allowed there).
- Change `prepareWallet` and `confirmWallet` (lines 277-305) to take no handle:

```ts
export const prepareWallet = () =>
  envelopeApi<
    | { existing: { wallet_id: string; address: string; policies_approved: boolean } }
    | UnsignedActivityDto
  >("/v1/signing/agents/wallet/prepare", { method: "POST", body: "{}" }).then(
    (data): PrepareWalletResult =>
      "existing" in data
        ? {
            existing: {
              walletId: data.existing.wallet_id,
              address: data.existing.address,
              policiesApproved: data.existing.policies_approved === true,
            },
          }
        : data,
  );

export const confirmWallet = (signed: SignedActivityDto) =>
  envelopeApi<{ wallet_id: string; address: string }>("/v1/signing/agents/wallet/confirm", {
    method: "POST",
    body: JSON.stringify({ signed }),
  }).then((data) => ({ walletId: data.wallet_id, address: data.address }));
```

- Add:

```ts
export interface StudioWallets {
  master: { address: string; ausdMicro: string | null; monWei: string | null };
  agents: {
    walletId: string;
    address: string;
    agentId: string | null;
    agentName: string | null;
    caps: { perTradeAusd: number; perDayAusd: number; maxLeverage: number } | null;
    policiesApproved: boolean;
    ausdMicro: string | null;
    monWei: string | null;
  }[];
  readAt: number;
}

export const studioWallets = () => studioApi<StudioWallets>("/wallets");

interface TransferBody {
  from: string;
  to: string;
  token: "AUSD" | "MON";
  amount: string;
}

export const transferPrepare = (body: TransferBody) =>
  studioApi<{ url: string; body: string; timestampMs: string; organizationId: string }>(
    "/wallets/transfers/prepare",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const transferConfirm = (body: TransferBody, signed: SignedActivityDto) =>
  studioApi<{ txHash: string }>("/wallets/transfers/confirm", {
    method: "POST",
    body: JSON.stringify({ ...body, signed }),
  });
```

- Add known messages for the new codes in the `knownMessage` map. Find it with
  `grep -n "knownMessage" apps/web/src/features/studio/*.ts apps/web/src/features/studio/lib/*.ts`.
  The entries:
  - `WALLET_UNDERFUNDED` / `wallet_underfunded`: "Fund its wallet with at least 10 AUSD and 0.5 MON first."
  - `WALLET_ASSIGNED`: "That wallet already belongs to an agent."
  - `POLICIES_MISSING`: "Sign its caps first."
  - `INSUFFICIENT_FUNDS`: "The wallet doesn't hold that much."
  - `TRANSFER_ALREADY_RECORDED`: "That transfer already went through."
  - `INVALID_TRANSFER`: "That transfer can't be made."

- [ ] **Step 5: Run the tests**

Run: `node --import tsx --test apps/web/test/studio-new-agent.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "Web: the create screen's rules and the studio API's new routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/api.ts apps/web/src/features/studio/new-agent/model.ts apps/web/test/studio-new-agent.test.ts
```

(The two `create/` callers of `prepareWallet` and `confirmWallet` break the web typecheck until
Task 12 deletes them. If you must keep the typecheck green between tasks, add the handle-less
calls in `create/create.tsx` too. That file goes away in Task 12 regardless.)

---

### Task 6: The ceremonies (pure) and the create screen

**Files:**

- Create: `apps/web/src/features/studio/new-agent/ceremony.ts`
- Test: `apps/web/test/studio-new-agent-ceremony.test.ts`
- Create: `apps/web/src/features/studio/new-agent/new-agent.tsx`, `identity.tsx`, `voice.tsx`, `reads.tsx`, `advanced.tsx`, `new-agent.module.css`

- [ ] **Step 1: Write the failing ceremony tests**

```ts
// apps/web/test/studio-new-agent-ceremony.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgent,
  createWallet,
  type CreateDeps,
  type WalletDeps,
} from "../src/features/studio/new-agent/ceremony";

const unsigned = (name: string) => ({
  url: name,
  body: name,
  timestampMs: "1",
  organizationId: "sub",
});
const signed = (u: { url: string; body: string }) => ({
  ...u,
  stamp: { stampHeaderName: "X-Stamp", stampHeaderValue: "s" },
});

function walletDeps(state: { delegated: boolean; existing?: boolean }) {
  const calls: string[] = [];
  const deps: WalletDeps = {
    state: async () => ({ hasSubOrganization: true, hasDelegatedUser: state.delegated }),
    stamp: async (u) => {
      calls.push(`stamp:${u.url}`);
      return signed(u);
    },
    prepareWallet: async () =>
      state.existing
        ? { existing: { walletId: "w", address: "0x1", policiesApproved: false } }
        : unsigned("wallet"),
    confirmWallet: async () => ({ walletId: "w", address: "0x1" }),
    prepareDelegated: async () => unsigned("delegated"),
    confirmDelegated: async () => {
      calls.push("delegated");
    },
    onStep: (step) => calls.push(`step:${step}`),
  };
  return { deps, calls };
}

test("the first wallet is two stamps: the wallet, then the delegated user", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:wallet", "stamp:delegated"],
  );
});

test("a later wallet is one stamp", async () => {
  const { deps, calls } = walletDeps({ delegated: true });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:wallet"],
  );
});

test("a wallet an earlier attempt left is reused without a stamp, and step 2 still runs", async () => {
  const { deps, calls } = walletDeps({ delegated: false, existing: true });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:delegated"],
  );
});

test("the steps are announced as 1 then 2", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("step:")),
    ["step:1", "step:2"],
  );
});

test("create signs the policies, then creates the draft", async () => {
  const calls: string[] = [];
  const deps: CreateDeps = {
    stamp: async (u) => {
      calls.push(`stamp:${u.url}`);
      return signed(u);
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => {
      calls.push("confirmed");
      return { policyIds: ["a", "b", "c"] };
    },
    createDraft: async () => {
      calls.push("draft");
      return { productId: "p" };
    },
  };
  const result = await createAgent(deps, { walletId: "w", policiesApproved: false });
  assert.deepEqual(calls, ["stamp:policies", "confirmed", "draft"]);
  assert.equal(result.productId, "p");
});

test("create skips the stamp when the policies were already approved", async () => {
  const calls: string[] = [];
  const deps: CreateDeps = {
    stamp: async () => {
      calls.push("stamp");
      throw new Error("no");
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => ({ policyIds: [] }),
    createDraft: async () => {
      calls.push("draft");
      return { productId: "p" };
    },
  };
  await createAgent(deps, { walletId: "w", policiesApproved: true });
  assert.deepEqual(calls, ["draft"]);
});

test("a cancelled stamp stops before the draft", async () => {
  const deps: CreateDeps = {
    stamp: async () => {
      throw Object.assign(new Error("closed"), { name: "NotAllowedError" });
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => ({ policyIds: [] }),
    createDraft: async () => {
      throw new Error("must not run");
    },
  };
  await assert.rejects(createAgent(deps, { walletId: "w", policiesApproved: false }), {
    name: "NotAllowedError",
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --import tsx --test apps/web/test/studio-new-agent-ceremony.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `ceremony.ts`**

```ts
// apps/web/src/features/studio/new-agent/ceremony.ts
/**
 * The create screen's two signature moments, as sequences and nothing else (spec §3.1):
 *
 * - `createWallet`: "Create its wallet". Step 1 is the wallet under the person's passkey; step 2,
 *   the first time only, is Pickler's delegated user ("Let Pickler trade from it"). A wallet an
 *   earlier attempt left unlinked comes back from `prepareWallet` as `existing` and is reused
 *   without a stamp; step 2 still runs when the delegated user is missing.
 * - `createAgent`: "Create {name}". The wallet's policies (one stamp), then the draft. Skipped when
 *   the policies were already approved (a retry), so they are never written twice.
 *
 * No React, no transport and no `@pickler/api-schema` value import, so the order is pinned from
 * node:test with fakes (`apps/web/test/studio-new-agent-ceremony.test.ts`).
 */
export interface UnsignedActivity {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}
export interface SignedActivity {
  url: string;
  body: string;
  stamp: { stampHeaderName: string; stampHeaderValue: string };
}

export interface WalletDeps {
  state(): Promise<{ hasSubOrganization: boolean; hasDelegatedUser: boolean }>;
  stamp(unsigned: UnsignedActivity): Promise<SignedActivity>;
  prepareWallet(): Promise<
    | UnsignedActivity
    | { existing: { walletId: string; address: string; policiesApproved: boolean } }
  >;
  confirmWallet(signed: SignedActivity): Promise<{ walletId: string; address: string }>;
  prepareDelegated(): Promise<UnsignedActivity>;
  confirmDelegated(signed: SignedActivity): Promise<void>;
  /** 1 while the wallet is made, 2 while the delegated user is. */
  onStep(step: 1 | 2): void;
}

/** The person has no sub-organization: send them to signup's passkey step. Thrown before any prompt. */
export class NoSubOrganization extends Error {
  constructor() {
    super("Your wallet has not been created yet. Create it with your passkey first.");
    this.name = "NoSubOrganization";
  }
}

export async function createWallet(
  deps: WalletDeps,
): Promise<{ walletId: string; address: string; policiesApproved: boolean }> {
  const state = await deps.state();
  if (!state.hasSubOrganization) {
    throw new NoSubOrganization();
  }
  deps.onStep(1);
  const prepared = await deps.prepareWallet();
  const wallet =
    "existing" in prepared
      ? prepared.existing
      : { ...(await deps.confirmWallet(await deps.stamp(prepared))), policiesApproved: false };
  if (!state.hasDelegatedUser) {
    deps.onStep(2);
    await deps.confirmDelegated(await deps.stamp(await deps.prepareDelegated()));
  }
  return wallet;
}

export interface CreateDeps {
  stamp(unsigned: UnsignedActivity): Promise<SignedActivity>;
  preparePolicies(walletId: string): Promise<UnsignedActivity>;
  confirmPolicies(walletId: string, signed: SignedActivity): Promise<{ policyIds: string[] }>;
  createDraft(): Promise<{ productId: string }>;
}

export async function createAgent(
  deps: CreateDeps,
  wallet: { walletId: string; policiesApproved: boolean },
): Promise<{ productId: string }> {
  if (!wallet.policiesApproved) {
    await deps.confirmPolicies(
      wallet.walletId,
      await deps.stamp(await deps.preparePolicies(wallet.walletId)),
    );
  }
  return deps.createDraft();
}
```

- [ ] **Step 4: Run the ceremony tests**

Run: `node --import tsx --test apps/web/test/studio-new-agent-ceremony.test.ts`
Expected: PASS (7).

- [ ] **Step 5: The screen's styles**

Create `apps/web/src/features/studio/new-agent/new-agent.module.css`, tokens only. Reuse the
existing classes by **composing** them from `../home/home.module.css`
(`composes: briefCard from "../home/home.module.css";`) instead of copying. The classes the
components below need:

```css
/* The create screen ("Pickler Studio Empty v5"): the brief column and the wallet column. Tokens
   only; the brief's cards, labels and steppers compose the home's so the two read as one product. */

.main {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  align-items: flex-start;
  justify-content: center;
  padding: 36px 28px 60px;
  flex: 1 1 520px;
  min-width: 0;
}
.column {
  display: flex;
  flex: 1 1 460px;
  flex-direction: column;
  gap: 14px;
  max-width: 680px;
  min-width: 0;
}
.kicker {
  margin: 6px 0 0;
  font: 600 11px/1 var(--pk-font);
  letter-spacing: 0.12em;
  color: var(--pk-ink-muted);
}

.identity {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-top: 6px;
}
.avatarButton {
  position: relative;
  flex: none;
  width: 96px;
  height: 96px;
  padding: 0;
  border: none;
  border-radius: var(--pk-radius-xl);
  cursor: pointer;
  overflow: hidden;
}
.avatarGrid {
  position: absolute;
  inset: 14px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.avatarGridSmall {
  inset: 4px;
  gap: 1px;
}
.avatarCell {
  border-radius: 3px;
}
.avatarCell[data-on="true"] {
  background: var(--pk-on-lime);
}
.avatarEdit {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-bg);
  color: var(--pk-ink);
}
.nameInput {
  composes: briefNameInput from "../home/home.module.css";
}
.handleRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.handleField {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-panel);
}
.handleField input {
  width: 150px;
  padding: 9px 0;
  border: none;
  background: transparent;
  font: 600 12.5px/1 var(--pk-font);
  letter-spacing: 0.02em;
  color: inherit;
  outline: none;
}
.handleField[data-tone="lime"] {
  color: var(--pk-lime-ink);
}
.handleField[data-tone="pink"] {
  color: var(--pk-state-loss-ink);
}
.handleField[data-tone="faint"] {
  color: var(--pk-ink-faint);
}
.handleNote {
  font: 600 10.5px/1 var(--pk-font);
  letter-spacing: 0.08em;
  color: var(--pk-ink-faint);
}
.handleNote[data-tone="lime"] {
  color: var(--pk-lime-ink);
}
.handleNote[data-tone="pink"] {
  color: var(--pk-state-loss-ink);
}

.card {
  composes: briefCard from "../home/home.module.css";
}
.cardHead {
  composes: briefCardHead from "../home/home.module.css";
}
.label {
  composes: briefLabel from "../home/home.module.css";
}
.sub {
  composes: briefSub from "../home/home.module.css";
}
.tag {
  composes: briefTag from "../home/home.module.css";
}

.voices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.voice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-bg);
  color: var(--pk-ink-soft);
  font: 600 13.5px/1 var(--pk-font);
  cursor: pointer;
}
.voice[aria-pressed="true"] {
  background: var(--pk-ink);
  color: var(--pk-bg);
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--accent);
}
.sample {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--pk-radius-md);
  background: var(--pk-bg);
  font: 400 15px/1.4 var(--pk-font);
  color: var(--pk-ink-soft);
  text-wrap: pretty;
}

.plugins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 6px;
}
.plugin {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--pk-rule);
  border-radius: var(--pk-radius-md);
  background: transparent;
  color: var(--pk-ink);
  text-align: left;
  cursor: pointer;
}
.plugin[data-on="true"] {
  border-color: transparent;
  background: var(--pk-bg);
}
.plugin[data-fixed="true"] {
  border-color: var(--pk-lime-edge);
  cursor: default;
}
.pluginText {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.pluginName {
  font: 600 14px/1 var(--pk-font);
  letter-spacing: -0.02em;
}
.pluginNote {
  font: 500 11px/1.3 var(--pk-font);
  color: var(--pk-ink-muted);
}
.fixed {
  display: grid;
  place-items: center;
  width: 34px;
  height: 20px;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-state-good-bg);
  color: var(--pk-state-good-ink);
}
.web {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--pk-radius-md);
  background: var(--pk-bg);
}
.webHead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.webTitle {
  font: 600 10px/1 var(--pk-font);
  letter-spacing: 0.12em;
  color: var(--pk-ink-muted);
}
.sites {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.site {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 6px 7px 12px;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-panel);
  font: 600 12px/1 var(--pk-font);
}
.siteRemove {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-bg);
  color: var(--pk-ink-muted);
  cursor: pointer;
}
.siteInput {
  flex: 1 1 180px;
  min-width: 0;
  padding: 8px 6px;
  border: none;
  background: transparent;
  font: 600 12.5px/1 var(--pk-font);
  color: var(--pk-ink);
  outline: none;
}
.note {
  font: 600 9.5px/1.3 var(--pk-font);
  letter-spacing: 0.08em;
  color: var(--pk-ink-faint);
}
.note[data-bad="true"] {
  color: var(--pk-state-loss-ink);
}

.advancedToggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 1px dashed var(--pk-rule-strong);
  border-radius: var(--pk-radius-pill);
  background: transparent;
  color: var(--pk-ink-muted);
  font: 600 11px/1.3 var(--pk-font);
  letter-spacing: 0.1em;
  text-align: left;
  cursor: pointer;
}
.advancedSummary {
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--pk-ink-faint);
}
.advanced {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.foot {
  margin: -4px 0 0;
  text-align: center;
  font: 600 10.5px/1 var(--pk-font);
  letter-spacing: 0.08em;
  color: var(--pk-ink-faint);
}
.alert {
  composes: alert from "../home/home.module.css";
}
```

Every token used here must exist in `packages/ui/src/styles.css`. Check each one with
`grep -o "\-\-pk-[a-z0-9-]*" apps/web/src/features/studio/new-agent/new-agent.module.css | sort -u | while read t; do grep -q -- "$t:" packages/ui/src/styles.css || echo "missing $t"; done`.
Replace any missing one with the nearest existing token; `--pk-radius-xl` may be `-2xl` or `-lg`
in this repo. Never add a literal. `alert` is a class in `home.module.css`; check with
`grep -n "^\.alert" apps/web/src/features/studio/home/home.module.css`.

- [ ] **Step 6: The section components**

`identity.tsx`:

```tsx
"use client";
import { Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { deriveHandle, patternCells, type HandleState, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

const tone = (state: HandleState) =>
  state === "free" ? "lime" : state === "empty" || state === "checking" ? "faint" : "pink";

/** The avatar button, the name, and the handle that follows it. */
export function Identity({
  form,
  handle,
  disabled,
  onChange,
  onAvatar,
}: {
  form: NewAgentForm;
  handle: HandleState;
  disabled: boolean;
  onChange(next: NewAgentForm): void;
  onAvatar(): void;
}) {
  const derived = deriveHandle(form.name, form.handle);
  const note =
    !form.name.trim() && !form.handle
      ? "FROM THE NAME"
      : handle === "free"
        ? `@${derived} IS FREE`
        : handle === "taken"
          ? `@${derived} IS TAKEN · TYPE ANOTHER`
          : handle === "checking"
            ? "CHECKING"
            : handle === "failed"
              ? "COULDN'T CHECK · TRY AGAIN"
              : "3–15 CHARS · a–z 0–9 _";
  return (
    <div className={styles.identity}>
      <button
        type="button"
        className={styles.avatarButton}
        style={accentVars(form.accent)}
        data-accent-fill=""
        onClick={onAvatar}
        aria-label="Pick its avatar"
        disabled={disabled}
      >
        <AvatarGrid pattern={form.pattern} />
        <span className={styles.avatarEdit} aria-hidden="true">
          <Icon name="sliders" size={12} />
        </span>
      </button>
      <div className={styles.column}>
        <h1 className={styles.srOnly} id="new-agent-title">
          Your new agent
        </h1>
        <input
          id="new-agent-name"
          className={styles.nameInput}
          aria-label="Name it"
          placeholder="Name it"
          value={form.name}
          maxLength={40}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
        <div className={styles.handleRow}>
          <span className={styles.handleField} data-tone={tone(handle)}>
            @
            <input
              aria-label="Its handle"
              value={form.handle}
              placeholder={derived || "username"}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...form, handle: event.target.value.replace(/^@+/, "") })
              }
            />
          </span>
          <span
            className={styles.handleNote}
            data-tone={tone(handle)}
            role="status"
            aria-live="polite"
          >
            {note}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AvatarGrid({ pattern, small = false }: { pattern: number; small?: boolean }) {
  return (
    <span
      className={`${styles.avatarGrid} ${small ? styles.avatarGridSmall : ""}`}
      aria-hidden="true"
    >
      {patternCells(pattern).map((on, index) => (
        <span key={index} className={styles.avatarCell} data-on={on} />
      ))}
    </span>
  );
}
```

The avatar's fill is the accent. Add to the CSS:
`.avatarButton { background: var(--accent); }`. `accentVars` sets `--accent`
(`apps/web/src/lib/accent.ts:35-42`). Add `.srOnly { composes: srOnly from "../home/home.module.css"; }`.
Drop the `data-accent-fill` attribute if nothing reads it.

`voice.tsx`:

```tsx
"use client";
import { accentVars } from "@/lib/accent";
import { VOICES, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

export function Voice({
  form,
  disabled,
  onChange,
}: {
  form: NewAgentForm;
  disabled: boolean;
  onChange(next: NewAgentForm): void;
}) {
  const picked = VOICES.find((voice) => voice.key === form.voice);
  return (
    <div className={styles.card} id="new-agent-voice">
      <div className={styles.cardHead}>
        <span className={styles.label}>VOICE</span>
        <span className={styles.sub}>how every post reads</span>
        <span className={styles.tag} data-filled={Boolean(picked)}>
          {picked ? picked.name.toUpperCase() : "PICK ONE"}
        </span>
      </div>
      <div className={styles.voices} role="group" aria-label="Voice">
        {VOICES.map((voice) => (
          <button
            key={voice.key}
            type="button"
            className={styles.voice}
            aria-pressed={form.voice === voice.key}
            disabled={disabled}
            style={accentVars(voice.tint)}
            onClick={() => onChange({ ...form, voice: voice.key })}
          >
            <span className={styles.swatch} aria-hidden="true" />
            {voice.name}
          </button>
        ))}
      </div>
      <p className={styles.sample}>{picked ? picked.sample : "Pick one to see its first post."}</p>
    </div>
  );
}
```

`reads.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Icon, Segmented } from "@pickler/ui";
import { MAX_SITES, siteHost, siteNote, type NewAgentForm, type WebMode } from "./model";
import styles from "./new-agent.module.css";

const MODES: { value: WebMode; label: string }[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "prefer", label: "Prefer these" },
  { value: "only", label: "Only these" },
];

export function Reads({
  form,
  disabled,
  onChange,
}: {
  form: NewAgentForm;
  disabled: boolean;
  onChange(next: NewAgentForm): void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const host = siteHost(draft);
    if (!host || form.sites.includes(host) || form.sites.length >= MAX_SITES) return;
    onChange({ ...form, sites: [...form.sites, host] });
    setDraft("");
  }
  const note = siteNote(form, draft);
  return (
    <div className={styles.card} id="new-agent-reads">
      <div className={styles.cardHead}>
        <span className={styles.label}>IT READS</span>
        <span className={styles.sub}>Perpl is always its market · the web is optional</span>
        <span className={styles.tag}>{form.webOn ? "PERPL + WEB" : "PERPL ONLY"}</span>
      </div>
      <div className={styles.plugins}>
        <div
          className={styles.plugin}
          data-on="true"
          data-fixed="true"
          title="listPerpMarkets · getPerpSnapshot · getPerpOrderBook · getPerpCandles · getPerpFundingHistory"
        >
          <span className={styles.pluginText}>
            <span className={styles.pluginName}>Perpl</span>
            <span className={styles.pluginNote}>Perp markets, books, funding, candles · Monad</span>
          </span>
          <span className={styles.fixed} aria-label="Always on">
            <Icon name="check" size={12} />
          </span>
        </div>
        <button
          type="button"
          className={styles.plugin}
          data-on={form.webOn}
          role="switch"
          aria-checked={form.webOn}
          disabled={disabled}
          title="searchWeb · readPage"
          onClick={() => onChange({ ...form, webOn: !form.webOn })}
        >
          <span className={styles.pluginText}>
            <span className={styles.pluginName}>Web</span>
            <span className={styles.pluginNote}>Search and page reads via Exa</span>
          </span>
          <span className={styles.toggle} data-on={form.webOn} aria-hidden="true">
            <i />
          </span>
        </button>
      </div>
      {form.webOn && (
        <div className={styles.web}>
          <div className={styles.webHead}>
            <span className={styles.webTitle}>WEB · WHERE EXA MAY LOOK</span>
            <Segmented
              label="Where the web may look"
              options={MODES}
              value={form.webMode}
              onChange={(webMode) => onChange({ ...form, webMode })}
            />
          </div>
          {form.webMode === "anywhere" ? (
            <span className={styles.note}>
              SEARCHES THE OPEN WEB · PICK “PREFER” OR “ONLY” TO NAME SITES
            </span>
          ) : (
            <>
              <div className={styles.sites}>
                {form.sites.map((host) => (
                  <span key={host} className={styles.site}>
                    {host}
                    <button
                      type="button"
                      className={styles.siteRemove}
                      aria-label={`Remove ${host}`}
                      onClick={() =>
                        onChange({ ...form, sites: form.sites.filter((site) => site !== host) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className={styles.siteInput}
                  aria-label="Add a site"
                  value={draft}
                  disabled={disabled}
                  placeholder={form.sites.length ? "Add a site" : "coindesk.com, x.com…"}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={add}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      add();
                    } else if (event.key === "Backspace" && !draft && form.sites.length)
                      onChange({ ...form, sites: form.sites.slice(0, -1) });
                  }}
                />
              </div>
              <span className={styles.note} data-bad={note.bad}>
                {note.text}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

Add the switch styles to the CSS:

```css
.toggle {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-panel-3);
}
.toggle i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: var(--pk-radius-pill);
  background: var(--pk-ink-faint);
  transition: left var(--pk-duration);
}
.toggle[data-on="true"] {
  background: var(--pk-lime);
}
.toggle[data-on="true"] i {
  left: 17px;
  background: var(--pk-on-lime);
}
```

Check the `Segmented` props in `packages/ui/src/segmented.tsx`: `label`, `options`, `value` and
`onChange` are used by `deposit-sheet.tsx:180-187`.

`advanced.tsx` reuses the brief card pattern from `brief/brief-form.tsx:72-176` (sections and
risk steppers):

```tsx
"use client";
import { Icon } from "@pickler/ui";
import { lines, STARTER_CAPS, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

const SECTIONS = [
  {
    key: "thesis",
    label: "THESIS",
    sub: "why this edge exists, in plain words",
    rows: 3,
    placeholder: "What does this agent believe that the market does not price yet?",
  },
  {
    key: "enters",
    label: "ENTERS WHEN",
    sub: "every line must be true",
    rows: 4,
    placeholder: "Conditions, one per line.",
  },
  {
    key: "exits",
    label: "EXITS WHEN",
    sub: "the first line that turns true closes it",
    rows: 3,
    placeholder: "Take profit, stop, time limit…",
  },
  {
    key: "never",
    label: "NEVER",
    sub: "hard lines it will not cross",
    rows: 3,
    placeholder: "The things a tired human would do at 3am.",
  },
] as const;

const STEPPERS = [
  { key: "perTrade", title: "PER TRADE", step: 5, min: 5, max: 1_000, unit: " AUSD" },
  { key: "perDay", title: "PER DAY", step: 10, min: 10, max: 10_000, unit: " AUSD" },
  { key: "leverage", title: "MAX LEVERAGE", step: 1, min: 1, max: 10, unit: "×" },
] as const;

export function Advanced({
  form,
  open,
  disabled,
  onToggle,
  onChange,
}: {
  form: NewAgentForm;
  open: boolean;
  disabled: boolean;
  onToggle(): void;
  onChange(next: NewAgentForm): void;
}) {
  const edited =
    form.perTrade !== STARTER_CAPS.perTradeAusd ||
    form.perDay !== STARTER_CAPS.perDayAusd ||
    form.leverage !== STARTER_CAPS.maxLeverage;
  return (
    <>
      <button
        type="button"
        className={styles.advancedToggle}
        aria-expanded={open}
        aria-controls="new-agent-advanced"
        onClick={onToggle}
      >
        <Icon name="sliders" size={14} />
        ADVANCED SETTINGS
        <span className={styles.advancedSummary}>
          {" "}
          · thesis, entry and exit rules, hard lines, risk caps · a working default is loaded
        </span>
      </button>
      {open && (
        <div className={styles.advanced} id="new-agent-advanced">
          {SECTIONS.map((section) => {
            const value = form[section.key];
            const count = lines(value).length;
            return (
              <div
                key={section.key}
                className={styles.card}
                data-needed={section.key === "enters" && !value.trim()}
              >
                <div className={styles.cardHead}>
                  <label className={styles.label} htmlFor={`new-agent-${section.key}`}>
                    {section.label}
                  </label>
                  <span className={styles.sub}>{section.sub}</span>
                  <span className={styles.tag} data-filled={Boolean(value.trim())}>
                    {!value.trim()
                      ? "EMPTY"
                      : section.key === "thesis"
                        ? "SET"
                        : `${count} ${count === 1 ? "LINE" : "LINES"}`}
                  </span>
                </div>
                <textarea
                  id={`new-agent-${section.key}`}
                  className={styles.input}
                  rows={section.rows}
                  placeholder={section.placeholder}
                  value={value}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...form, [section.key]: event.target.value })}
                />
              </div>
            );
          })}
          <div className={styles.card} id="new-agent-risk">
            <div className={styles.cardHead}>
              <span className={styles.label}>RISK</span>
              <span className={styles.sub}>
                hard caps · it can only trade on Perpl and can&apos;t withdraw · Pickler holds every
                trade to these caps
              </span>
              <span className={styles.tag} data-filled={edited}>
                {edited ? "EDITED" : "STARTER CAPS"}
              </span>
            </div>
            <div className={styles.caps}>
              {STEPPERS.map((stepper) => {
                const value = form[stepper.key];
                const set = (next: number) =>
                  onChange({
                    ...form,
                    [stepper.key]: Math.min(stepper.max, Math.max(stepper.min, next)),
                  });
                return (
                  <div key={stepper.key} className={styles.cap}>
                    <span className={styles.capText}>
                      <span className={styles.capTitle}>{stepper.title}</span>
                      <span className={styles.capValue}>
                        {value}
                        {stepper.unit}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.capButton}
                      aria-label={`Lower ${stepper.title.toLowerCase()}`}
                      disabled={disabled || value <= stepper.min}
                      onClick={() => set(value - stepper.step)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={styles.capButton}
                      aria-label={`Raise ${stepper.title.toLowerCase()}`}
                      disabled={disabled || value >= stepper.max}
                      onClick={() => set(value + stepper.step)}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
            {form.perDay < form.perTrade && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={12} />A day&apos;s cap can&apos;t be below one
                trade&apos;s.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

Add to the CSS: `input`, `caps`, `cap`, `capText`, `capTitle`, `capValue` and `capButton`, each
composing its counterpart in `../home/home.module.css` (`briefInput`, `caps`, `cap`, `capText`,
`capTitle`, `capValue`, `capButton`). Also add
`.card[data-needed="true"] { composes: … }`. CSS modules cannot compose with attribute selectors,
so restate the rule at `home.module.css:612` with its token instead.

In `model.ts`, make `createLabel` also refuse `perDay < perTrade` ("Fix the caps to create"), and
add a test for it in `studio-new-agent.test.ts`.

- [ ] **Step 7: The screen**

`new-agent.tsx` composes these sections with the wallet panel (Task 7), the sheets and the
modals (Tasks 7-10). Take the top bar and rail as they are from `home/empty.tsx:288-345`; they are
copied in Task 12 when `empty.tsx` is deleted, so do it now. It keeps:

- the `HomeMenu` and the account link;
- the "No agent yet" chip, or the agent chip when a name exists;
- the TESTNET pill, followed by the two new pills (master wallet, AI credits), placed before it.

State:

- `form`;
- `availability` (debounced 350 ms through `handleAvailable`, as `empty.tsx:127-151` does it);
- `advancedOpen`;
- `wallet: WalletView | null` and `policiesApproved`;
- `sheet: null | { kind: "wallet" | "create"; phase: "idle" | "busy" | "ok" | "err"; step: 1 | 2 }`;
- `modal: null | "wallets" | "credits" | "avatar"`;
- `wallets: StudioWallets | null`;
- `error`.

On mount, unless `preview`, load `studioWallets()`. If it lists an agent wallet with
`agentId === null`, set it as `wallet`, with its balances parsed as `BigInt` and
`policiesApproved` from it. That restores a reload mid-setup.

Actions:

- `startWallet()`: open the wallet sheet. Its Continue runs `createWallet` with the real
  routes and `stampActivity(await relyingParty(), unsigned)`. `onStep` updates
  `sheet.step`; success sets the phase to "ok", and 650 ms later closes the sheet and reloads
  the wallets. A `NotAllowedError` or `AbortError` sets the phase to "err" (the same set as
  `deposit-sheet.tsx:22`).
- `refresh()`: reload `studioWallets()`, update `wallet` and the "last checked" time.
- `create()`: when `canCreate`, open the create sheet. Continue runs `createAgent` with
  `createDraft: () => createDraft(toDraftRequest(form, wallet.walletId))`, then calls
  `onCreated(productId)`.

Render, in this order:

1. the kicker ("YOUR FIRST AGENT · SET UP ITS TRADING STRATEGY", or "A NEW AGENT · SET UP ITS
   TRADING STRATEGY" when `hasAgents`);
2. `Identity`, `Voice`, `Reads` and `Advanced`;
3. the create `Button` (primary, `size="lg"`, `block`, `aria-disabled={!canCreate}`, label from
   `createLabel`);
4. the foot from `footNote`;
5. `aside`: `WalletPanel` (Task 7);
6. `PasskeySheet` (Task 7), `WalletsModal` (Task 8), `CreditsModal` (Task 9) and
   `AvatarPicker` (Task 10).

Props: `{ passkeys, canManage, preview, locked, error, staged, hasAgents, onCreated }`. `staged`
is a `NewAgentStaged | null` from `fixture.ts` (Task 11). It replaces `EmptyHome`'s props. The
root keeps `id="home-empty"` (the design check proves it, `scripts/design/routes.mjs:359`), plus
`data-surface="dark"` and `className={styles.home}` from `home.module.css`.

Until Tasks 7-10 land, import placeholders that render `null`, so the screen compiles now:

- `export function WalletPanel() { return null; }`;
- `export function PasskeySheet() { return null; }`;
- the same for the three modals.

Each later task replaces its placeholder with the real component.

- [ ] **Step 8: Typecheck and run the web tests**

Run: `npm run typecheck --workspace=@pickler/web && node --import tsx --test apps/web/test/studio-new-agent.test.ts apps/web/test/studio-new-agent-ceremony.test.ts`
Expected: the typecheck passes, except the `create/` and `home/empty.tsx` callers of the changed
`api.ts` functions, which Task 12 removes. If those block, update the call sites minimally in this
commit. The tests pass.

- [ ] **Step 9: Commit**

```bash
git commit -m "Studio: the create screen's ceremonies and its brief column (identity, voice, what it reads, advanced settings)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/new-agent apps/web/test/studio-new-agent.test.ts apps/web/test/studio-new-agent-ceremony.test.ts
```

---

### Task 7: The wallet panel and the passkey sheet

**Files:**

- Create: `apps/web/src/features/studio/new-agent/wallet-panel.tsx`, `apps/web/src/features/studio/new-agent/passkey-sheet.tsx` (replacing the placeholders)
- Modify: `apps/web/src/features/studio/new-agent/new-agent.module.css`, `new-agent.tsx`

- [ ] **Step 1: The wallet panel**

```tsx
"use client";
import Image from "next/image";
import { useState } from "react";
import { Button, Icon } from "@pickler/ui";
import {
  formatUnits,
  funded,
  MIN_START,
  walletTag,
  type NewAgentForm,
  type WalletView,
} from "./model";
import styles from "./new-agent.module.css";

/** "Its wallet" (canvas: Studio · Agent wallet overview). Step 0 until it exists, then balances and the minimums. */
export function WalletPanel({
  wallet,
  firstTime,
  form,
  checkedAt,
  arrivals,
  busy,
  preview,
  onCreateWallet,
  onRefresh,
  onFund,
}: {
  wallet: WalletView | null;
  /** No delegated user yet: creating the wallet is two signatures. */
  firstTime: boolean;
  form: NewAgentForm;
  checkedAt: string;
  arrivals: { text: string; at: string }[];
  busy: boolean;
  preview: boolean;
  onCreateWallet(): void;
  onRefresh(): void;
  onFund(): void;
}) {
  const [copied, setCopied] = useState(false);
  const isFunded = funded(wallet);
  return (
    <aside className={styles.side} aria-label="Its wallet">
      <Image className={styles.mascot} src="/brand/mascot.webp" alt="" width={96} height={80} />
      <div
        className={styles.walletCard}
        id="new-agent-wallet"
        data-ready={Boolean(wallet && isFunded)}
      >
        <div className={styles.walletHead}>
          <span className={styles.walletTitle}>ITS WALLET</span>
          <span className={styles.walletTag} data-tone={isFunded ? "good" : "caution"}>
            {walletTag(wallet)}
          </span>
        </div>
        {!wallet ? (
          <div className={styles.step0} id="new-agent-wallet-step0">
            <div className={styles.step0Head}>
              <span className={styles.step0Mark} aria-hidden="true">
                ?
              </span>
              <span className={styles.step0Text}>
                <b>No wallet yet</b>
                <small>ITS OWN KEYS · ITS OWN CAPS</small>
              </span>
            </div>
            <p className={styles.step0Note}>
              A wallet that is only its own.{" "}
              {firstTime ? "Two Touch IDs, back to back, the first time only." : "One Touch ID."}
            </p>
            {firstTime && (
              <ol className={styles.step0Steps}>
                <li>
                  <span>1</span>Its wallet, under your passkey
                </li>
                <li>
                  <span>2</span>Pickler may trade from it · inside the caps · never withdraw
                </li>
              </ol>
            )}
            <Button block disabled={busy || preview} onClick={onCreateWallet}>
              <Icon name="key" size={15} />
              {firstTime ? "Create its wallet · 2 signatures" : "Create its wallet"}
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.address}>
              <Image
                src="/brand/monad.png"
                alt=""
                width={30}
                height={30}
                className={styles.monad}
              />
              <span className={styles.addressText}>
                <b>{`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}</b>
                <small>AGENT WALLET · PICKLER MAY TRADE</small>
              </span>
              <button
                type="button"
                className={styles.chipButton}
                onClick={() =>
                  void navigator.clipboard?.writeText(wallet.address).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  })
                }
              >
                {copied ? "COPIED" : "COPY"}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Refresh balance"
                title="Refresh balance · if you sent AUSD from elsewhere"
                disabled={busy}
                onClick={onRefresh}
              >
                <Icon name="clock" size={14} />
              </button>
            </div>
            <div className={styles.tiles}>
              <span className={styles.tile}>
                <b data-good={(wallet.ausdMicro ?? 0n) >= MIN_START.ausdMicro}>
                  {formatUnits(wallet.ausdMicro, "AUSD")}
                </b>
                <small>AUSD · TRADES</small>
              </span>
              <span className={styles.tile}>
                <b data-good={(wallet.monWei ?? 0n) >= MIN_START.monWei}>
                  {formatUnits(wallet.monWei, "MON")}
                </b>
                <small>MON · GAS</small>
              </span>
            </div>
            <div className={styles.row}>
              <small>CAPS · TRADE / DAY / LEV</small>
              <b>{`${form.perTrade} / ${form.perDay} / ${form.leverage}×`}</b>
            </div>
            <span className={styles.note}>
              {checkedAt
                ? `LAST CHECKED ${checkedAt}${isFunded ? "" : " · WAITING FOR AUSD AND MON"}`
                : "NOT CHECKED YET"}
            </span>
            {!isFunded && (
              <div className={styles.row} data-tone="caution">
                <small>MIN TO START</small>
                <b>10 AUSD · 0.5 MON</b>
              </div>
            )}
            {arrivals.map((arrival) => (
              <div key={`${arrival.text}-${arrival.at}`} className={styles.arrival}>
                <i aria-hidden="true" />
                <span>{arrival.text}</span>
                <small>{arrival.at}</small>
              </div>
            ))}
            {!isFunded && (
              <>
                <Button variant="secondary" block disabled={preview} onClick={onFund}>
                  <Icon name="wallet" size={14} />
                  Fund from master wallet
                </Button>
                <span className={styles.note}>
                  ONE PASSKEY PER TOKEN · OR SEND TO THE ADDRESS FROM ANY MONAD WALLET, THEN REFRESH
                </span>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
```

`arrivals` comes from `new-agent.tsx`: when a refresh shows a balance higher than the last read,
push `"{delta} AUSD arrived"` or `"{delta} MON arrived"` with the time.

Add the panel classes to the CSS: `side`, `mascot`, `walletCard`, `walletHead`, `walletTitle`,
`walletTag`, `step0`, `step0Head`, `step0Mark`, `step0Text`, `step0Note`, `step0Steps`, `address`,
`monad`, `addressText`, `chipButton`, `iconButton`, `tiles`, `tile`, `row` and `arrival`. Follow
`home.module.css:460-520` (`briefSide`, `briefMascot`, `sideCard`, `sideTitle`), using
`--pk-panel`, `--pk-bg`, `--pk-rule`, `--pk-state-good-*`, `--pk-state-caution-*`,
`--pk-ink-*` and `--pk-radius-*`. `.walletCard[data-ready="false"]` gets no special border. The
canvas outlines the card in lime when only the money is missing; use `--pk-lime-edge` on
`.walletCard[data-outline="true"]` and set `data-outline` from `new-agent.tsx` when the name,
handle and voice are done but the wallet is not funded.

- [ ] **Step 2: The passkey sheet**

Follow `apps/web/src/features/auth/components/passkey-sheet.tsx` (a native `<dialog>` opened with
`showModal`, `data-surface="dark"`, styles at `auth.module.css:761-850`):

```tsx
"use client";
import { useEffect, useRef } from "react";
import { Button, Icon } from "@pickler/ui";
import styles from "./new-agent.module.css";

export type SheetPhase = "idle" | "busy" | "ok" | "err";

/** The canvas's passkey sheet: what will be signed, Continue, the Touch ID wait, done or cancelled. */
export function PasskeySheet({
  open,
  title,
  body,
  done,
  phase,
  twoStep,
  step,
  onContinue,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  done: string;
  phase: SheetPhase;
  twoStep: boolean;
  step: 1 | 2;
  onContinue(): void;
  onClose(): void;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = sheet.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={sheet}
      className={styles.sheet}
      data-surface="dark"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (phase !== "busy") onClose();
      }}
    >
      {twoStep && (
        <span className={styles.sheetSteps} aria-label={`Step ${step} of 2`}>
          <i data-on="true" />
          <i data-on={step === 2} />
        </span>
      )}
      <span className={styles.sheetIcon} data-phase={phase} aria-hidden="true">
        <Icon name={phase === "ok" ? "check" : phase === "err" ? "x" : "key"} size={26} />
      </span>
      <p className={styles.sheetTitle}>
        {phase === "err" ? "Passkey cancelled" : phase === "ok" ? done : title}
      </p>
      <p className={styles.sheetNote}>
        {phase === "err" ? "NOTHING WAS SIGNED · NOTHING MOVED" : body}
      </p>
      {phase === "idle" && (
        <div className={styles.sheetActions}>
          <Button onClick={onContinue}>Continue</Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
      {phase === "busy" && (
        <p className={styles.sheetWait} role="status">
          <i aria-hidden="true" />
          TOUCH ID
        </p>
      )}
      {phase === "err" && (
        <div className={styles.sheetActions}>
          <Button onClick={onContinue}>Try again</Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </dialog>
  );
}
```

The copy comes from `new-agent.tsx`, per spec §3.1:

- **wallet, step 1:** `Create {name}'s wallet?` / `UNDER YOUR PASSKEY · ONLY THIS AGENT USES IT · 1 OF 2` (without " · 1 OF 2" when not `firstTime`) / `Wallet ready`;
- **wallet, step 2:** `Let Pickler trade from it?` / `INSIDE THE CAPS ONLY · NEVER WITHDRAW · 2 OF 2` / `Wallet ready`;
- **create:** `Create {name}?` / `SETS ITS CAPS · {perTrade} / {perDay} AUSD · {leverage}× · IT CAN ONLY TRADE ON PERPL AND CAN'T WITHDRAW` / `{name} is yours`.

Add these classes to the CSS, restating `auth.module.css`'s `.sheet` rules (lines 767-842) with
the same tokens: `sheet` (with `[open]`, `::backdrop` and the 640 px media query), `sheetSteps`,
`sheetIcon` (with `[data-phase="ok"]` on `--pk-lime` / `--pk-on-lime` and `[data-phase="err"]` on
`--pk-state-loss-bg` / `-ink`), `sheetTitle`, `sheetNote`, `sheetActions` and `sheetWait` (a
blinking dot using the existing `pkBlink` keyframes from `home.module.css:1478-1490`; redeclare
the keyframes in this module). Check whether the `key` and `x` icons exist in
`packages/ui/src/icon.tsx`; `key` and `x` are both in `ICONS`.

- [ ] **Step 3: Wire both into `new-agent.tsx`, typecheck, look at it**

Replace the placeholders. Run `npm run typecheck --workspace=@pickler/web`. Start the design
harness's servers as `scripts/design/fixture-api.mjs` documents (lines 15-25), on 3001. Never run
a second dev server: check `lsof -nP -iTCP:3001 -sTCP:LISTEN` first. Open
`/studio?stage=create-empty` once Task 11 exists. Until then, open `/studio` with auth off; it
renders the fixture studio. Check the panel at 1400 and 390 px.

- [ ] **Step 4: Commit**

```bash
git commit -m "Studio: the agent's wallet panel and the passkey sheet (two signatures the first time, one after)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/new-agent
```

---

### Task 8: The Wallets modal and transfers

**Files:**

- Create: `apps/web/src/features/studio/new-agent/wallets-modal.tsx`
- Modify: `new-agent.tsx` (the top-bar pill opens it; `onFund` opens it on the agent's wallet with "to agent" selected), `new-agent.module.css`

- [ ] **Step 1: Write the modal**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Icon, Segmented } from "@pickler/ui";
import { SessionExpired } from "@/features/auth/lib/custody";
import { errorCode, transferConfirm, transferPrepare, type StudioWallets } from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";
import { formatUnits, parseAmount, transferLabel, type Token } from "./model";
import styles from "./new-agent.module.css";

const CLOSED_PROMPT = new Set(["NotAllowedError", "AbortError"]);
const big = (value: string | null) => (value === null ? null : BigInt(value));

/** The canvas's "Your wallets": the master and each agent wallet, with fund and pull. One token, one passkey. */
export function WalletsModal({
  open,
  wallets,
  openOn,
  preview,
  onClose,
  onMoved,
}: {
  open: boolean;
  wallets: StudioWallets | null;
  /** Open with this agent wallet's move form showing, toward the agent. */
  openOn: string | null;
  preview: boolean;
  onClose(): void;
  onMoved(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [moving, setMoving] = useState<{ walletId: string; toAgent: boolean } | null>(
    openOn ? { walletId: openOn, toAgent: true } : null,
  );
  const [token, setToken] = useState<Token>("AUSD");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    if (openOn) setMoving({ walletId: openOn, toAgent: true });
  }, [openOn]);

  async function move(walletId: string, toAgent: boolean, held: bigint | null) {
    const units = parseAmount(amount, token);
    if (units === null || held === null || units > held) return;
    const body = {
      from: toAgent ? "master" : walletId,
      to: toAgent ? walletId : "master",
      token,
      amount,
    };
    setBusy(true);
    setError("");
    try {
      const unsigned = await transferPrepare(body);
      const signed = await stampActivity(await relyingParty(), unsigned);
      await transferConfirm(body, signed);
      setAmount("");
      setMoving(null);
      onMoved();
    } catch (caught) {
      if (caught instanceof Error && CLOSED_PROMPT.has(caught.name))
        setError("The passkey prompt was closed. Nothing moved.");
      else if (caught instanceof SessionExpired)
        setError("Your sign-in expired. Sign in again; nothing moved.");
      else if (errorCode(caught) === "TRANSFER_ALREADY_RECORDED") {
        setMoving(null);
        onMoved();
      } else setError(caught instanceof Error ? caught.message : "It did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      data-surface="dark"
      aria-labelledby="wallets-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.modalHead}>
        <span className={styles.tabs}>
          <span className={styles.tab} aria-current="page">
            Wallets
          </span>
        </span>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <h2 className={styles.modalTitle} id="wallets-title">
        YOUR WALLETS<span>.</span>
      </h2>
      <p className={styles.modalLead}>
        One master wallet funds everything. Each agent gets its own, capped by its brief. All on
        Monad testnet, all behind your passkey.
      </p>
      {wallets && (
        <>
          <div className={styles.walletBox} data-master="true">
            <div className={styles.walletBoxHead}>
              <span className={styles.walletBoxName}>
                <b>Master wallet</b>
                <small>{wallets.master.address}</small>
              </span>
              <span className={styles.walletTag} data-tone="good">
                FUNDS AGENTS
              </span>
            </div>
            <div className={styles.tiles}>
              <span className={styles.tile}>
                <b>{formatUnits(big(wallets.master.ausdMicro), "AUSD")}</b>
                <small>AUSD</small>
              </span>
              <span className={styles.tile}>
                <b>{formatUnits(big(wallets.master.monWei), "MON")}</b>
                <small>MON · GAS</small>
              </span>
            </div>
          </div>
          <span className={styles.webTitle}>AGENT WALLETS · {wallets.agents.length}</span>
          {wallets.agents.map((agent) => {
            const open = moving?.walletId === agent.walletId;
            const toAgent = moving?.toAgent ?? true;
            const held = toAgent
              ? big(token === "AUSD" ? wallets.master.ausdMicro : wallets.master.monWei)
              : big(token === "AUSD" ? agent.ausdMicro : agent.monWei);
            const name = agent.agentName ?? "Your new agent";
            const label = transferLabel({ amount, token, toAgent, held, agentName: name });
            const ok = label.startsWith("Send") || label.startsWith("Pull");
            return (
              <div
                key={agent.walletId}
                className={styles.walletBox}
                id={`wallet-${agent.walletId}`}
              >
                <div className={styles.walletBoxHead}>
                  <span className={styles.walletBoxName}>
                    <b>{name} · agent wallet</b>
                    <small>{agent.address}</small>
                  </span>
                  <span
                    className={styles.walletTag}
                    data-tone={agent.agentId ? "caution" : "quiet"}
                  >
                    {agent.agentId ? "DRAFT" : "CREATING"}
                  </span>
                </div>
                <div className={styles.tiles}>
                  <span className={styles.tile}>
                    <b>{formatUnits(big(agent.ausdMicro), "AUSD")}</b>
                    <small>AUSD · TRADES</small>
                  </span>
                  <span className={styles.tile}>
                    <b>{formatUnits(big(agent.monWei), "MON")}</b>
                    <small>MON · GAS</small>
                  </span>
                </div>
                {agent.caps && (
                  <div className={styles.row}>
                    <small>CAPS · TRADE / DAY / LEV</small>
                    <b>{`${agent.caps.perTradeAusd} / ${agent.caps.perDayAusd} / ${agent.caps.maxLeverage}×`}</b>
                  </div>
                )}
                <div className={styles.moveButtons}>
                  <Button
                    variant={open && toAgent ? "primary" : "secondary"}
                    size="sm"
                    disabled={preview}
                    onClick={() => {
                      setMoving({ walletId: agent.walletId, toAgent: true });
                      setAmount("");
                    }}
                  >
                    Fund from master
                  </Button>
                  <Button
                    variant={open && !toAgent ? "primary" : "secondary"}
                    size="sm"
                    disabled={preview}
                    onClick={() => {
                      setMoving({ walletId: agent.walletId, toAgent: false });
                      setAmount("");
                    }}
                  >
                    Pull back to master
                  </Button>
                </div>
                {open && (
                  <div className={styles.move}>
                    <div className={styles.moveRow}>
                      <Segmented
                        label="Token"
                        options={[
                          { value: "AUSD", label: "AUSD" },
                          { value: "MON", label: "MON" },
                        ]}
                        value={token}
                        onChange={(next: Token) => {
                          setToken(next);
                          setAmount("");
                        }}
                      />
                      <span className={styles.amountField} data-bad={label.startsWith("More")}>
                        <input
                          inputMode="decimal"
                          aria-label={`Amount in ${token}`}
                          placeholder="0"
                          value={amount}
                          onChange={(event) =>
                            setAmount(event.target.value.replace(/[^0-9.]/g, ""))
                          }
                        />
                        <button
                          type="button"
                          className={styles.chipButton}
                          onClick={() => setAmount(formatUnits(held, token))}
                        >
                          MAX
                        </button>
                        <small>{token}</small>
                      </span>
                    </div>
                    <div className={styles.moveButtons}>
                      <Button
                        block
                        disabled={!ok || busy}
                        onClick={() => void move(agent.walletId, toAgent, held)}
                      >
                        {busy ? "Waiting for your passkey…" : label}
                      </Button>
                      <Button variant="ghost" onClick={() => setMoving(null)}>
                        Cancel
                      </Button>
                    </div>
                    <span
                      className={styles.note}
                    >{`${toAgent ? "MASTER HOLDS" : "IT HOLDS"} ${formatUnits(held, token)} ${token} · ONE TOKEN PER TRANSACTION${toAgent ? "" : " · OPEN POSITIONS STAY"}`}</span>
                  </div>
                )}
              </div>
            );
          })}
          {error && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={13} />
              {error}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
```

`MAX` uses `formatUnits`, which truncates to 4 decimals, so it never exceeds the balance. Add a
test: `formatUnits(1_234_567n, "AUSD") === "1.2345"`.

The `"x"` icon: check `packages/ui/src/icon.tsx`; `x` is listed.

- [ ] **Step 2: CSS**

Add `modal` (the sheet's rules, wider: `max-width: 620px`), `modalHead`, `tabs`, `tab`,
`modalTitle` (with `span { color: var(--pk-lime-ink); }`), `modalLead`, `walletBox`
(`[data-master="true"]` bordered with `--pk-lime-edge`), `walletBoxHead`, `walletBoxName`,
`moveButtons`, `move`, `moveRow` and `amountField` (`[data-bad="true"]` bordered with
`--pk-state-loss-ink`). Add `walletTag[data-tone="quiet"]` (ink-faint on panel). Tokens only.

- [ ] **Step 3: Top-bar pill**

In `new-agent.tsx`'s top bar, before the TESTNET pill:

```tsx
<button
  type="button"
  className={styles.topPill}
  onClick={() => setModal("wallets")}
  title="Your wallets"
>
  <Image src="/brand/monad.png" alt="" width={16} height={16} />
  <span>
    {formatUnits(masterAusd, "AUSD")}
    <small> AUSD</small>
  </span>
  <i aria-hidden="true" />
  <span>
    {formatUnits(masterMon, "MON")}
    <small> MON</small>
  </span>
</button>
```

`masterAusd` and `masterMon` are parsed from `wallets.master`. Add the `topPill` styles, composing
`pill` from `../home/home.module.css`.

- [ ] **Step 4: Unit test the label edges, typecheck, commit**

Add to `apps/web/test/studio-new-agent.test.ts`:

```ts
test("pulling back names the agent when it holds too little", () => {
  assert.equal(
    transferLabel({
      amount: "5",
      token: "AUSD",
      toAgent: false,
      held: 1_000_000n,
      agentName: "Halftime",
    }),
    "More AUSD than Halftime holds",
  );
});

test("formatUnits truncates to four decimals", () => {
  assert.equal(formatUnits(1_234_567n, "AUSD"), "1.2345");
});
```

Run: `node --import tsx --test apps/web/test/studio-new-agent.test.ts && npm run typecheck --workspace=@pickler/web`
Expected: PASS.

```bash
git commit -m "Studio: the Wallets modal: the master and each agent wallet, fund and pull, one token per passkey

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/new-agent apps/web/test/studio-new-agent.test.ts
```

---

### Task 9: The AI credits modal (display only)

**Files:**

- Create: `apps/web/src/features/studio/new-agent/credits-modal.tsx`
- Modify: `new-agent.tsx` (the AI credits pill), `new-agent.module.css`

- [ ] **Step 1: Write it**

```tsx
"use client";
import { useEffect, useRef } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import styles from "./new-agent.module.css";

/** AI credits (D11): what they will be, and the top-up shut with "Soon". No balance exists yet, so none is shown. */
export function CreditsModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      data-surface="dark"
      aria-labelledby="credits-title"
      id="new-agent-credits"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.modalHead}>
        <span className={styles.tabs}>
          <span className={styles.tab} aria-current="page">
            AI credits
          </span>
        </span>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <h2 className={styles.modalTitle} id="credits-title">
        AI CREDITS<span>.</span>
      </h2>
      <p className={styles.modalLead}>
        Every run your agents make costs model time. Soon it is charged from a credits balance you
        top up from your master wallet, not from any agent&apos;s wallet. Until then, Pickler pays.
      </p>
      <div className={styles.walletBox}>
        <div className={styles.walletBoxHead}>
          <span className={styles.webTitle}>ADD CREDITS · FROM MASTER WALLET</span>
          <Tag className={styles.soon}>SOON</Tag>
        </div>
        <Button block aria-disabled="true" disabled>
          Add credits
        </Button>
        <span className={styles.note}>
          1 AUSD = $1 OF CREDIT · ONE PASSKEY · CREDITS DON&apos;T COME BACK AS AUSD
        </span>
      </div>
    </dialog>
  );
}
```

Add the pill to the top bar:

```tsx
<button
  type="button"
  className={styles.topPill}
  onClick={() => setModal("credits")}
  title="AI credits"
>
  <i className={styles.creditsDot} aria-hidden="true" />
  <small>AI CREDITS</small>
  <span>Soon</span>
</button>
```

Add `soon` (composing `soon` from `../home/home.module.css`) and `creditsDot` (`--pk-ink-faint`) to
the CSS.

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck --workspace=@pickler/web`
Expected: PASS.

```bash
git commit -m "Studio: the AI credits pill and modal, top-up marked Soon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/new-agent
```

---

### Task 10: The avatar picker

**Files:**

- Create: `apps/web/src/features/studio/new-agent/avatar-picker.tsx`
- Modify: `new-agent.tsx`, `new-agent.module.css`

- [ ] **Step 1: Write it**

```tsx
"use client";
import { useEffect, useRef } from "react";
import { Button, Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { AvatarGrid } from "./identity";
import { ACCENT_OPTIONS, AVATAR_PATTERNS, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

/** "Its avatar": one accent, one pattern. It shows on its profile, its posts and the board. */
export function AvatarPicker({
  open,
  form,
  onChange,
  onClose,
}: {
  open: boolean;
  form: NewAgentForm;
  onChange(next: NewAgentForm): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      data-surface="dark"
      aria-labelledby="avatar-title"
      id="new-agent-avatar"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.modalHead}>
        <h2 className={styles.modalTitle} id="avatar-title">
          ITS AVATAR<span>.</span>
        </h2>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <p className={styles.modalLead}>
        One accent, one pattern. It shows on its profile, its posts and the board.
      </p>
      <span className={styles.webTitle}>ACCENT</span>
      <div className={styles.accents} role="radiogroup" aria-label="Accent">
        {ACCENT_OPTIONS.map((accent) => (
          <button
            key={accent}
            type="button"
            role="radio"
            aria-checked={form.accent === accent}
            aria-label={accent}
            className={styles.accentOption}
            style={accentVars(accent)}
            onClick={() => onChange({ ...form, accent })}
          />
        ))}
      </div>
      <span className={styles.webTitle}>PATTERN</span>
      <div className={styles.patterns} role="radiogroup" aria-label="Pattern">
        {AVATAR_PATTERNS.map((_, index) => (
          <button
            key={index}
            type="button"
            role="radio"
            aria-checked={form.pattern === index}
            aria-label={`Pattern ${index + 1}`}
            className={styles.patternOption}
            style={accentVars(form.accent)}
            onClick={() => onChange({ ...form, pattern: index })}
          >
            <AvatarGrid pattern={index} />
          </button>
        ))}
      </div>
      <Button block onClick={onClose}>
        Done
      </Button>
    </dialog>
  );
}
```

Add the CSS:

- `accents` and `patterns`: grids of 7 and 6 columns;
- `accentOption`: `aspect-ratio: 1`, `background: var(--accent)`, `border: 2px solid transparent`,
  `border-radius: var(--pk-radius-md)`, and `[aria-checked="true"] { border-color: var(--pk-ink); }`;
- `patternOption`: the same rules, with `position: relative` and `overflow: hidden`.

`accentVars` points `--accent` at `--pk-agent-{hue}-fill` (`apps/web/src/lib/accent.ts:35-42`),
so there are no literals.

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck --workspace=@pickler/web`
Expected: PASS.

```bash
git commit -m "Studio: the avatar picker, seven accents and six patterns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/new-agent
```

---

### Task 11: Wire into the studio, and the design-harness preview states

**Files:**

- Create: `apps/web/src/features/studio/new-agent/fixture.ts`
- Modify: `apps/web/src/features/studio/home/stage.ts` (the `create-*` stages replace the `brief-*` stages)
- Modify: `apps/web/src/features/studio/studio.tsx:43-46, 130-134, 427-441, 548-551` (render `NewAgent`; the "new" view; the menu callback)
- Modify: `apps/web/src/features/studio/home/menu.tsx:105-116` and `home/home.tsx:247` (`onNew`)
- Modify: `scripts/design/routes.mjs:361-396` (the stage routes)
- Test: `apps/web/test/studio.test.ts` or wherever `stageFromSearch` is pinned (`grep -ln "stageFromSearch" apps/web/test`)

- [ ] **Step 1: Write the failing stage tests**

In the stage test file:

```ts
test("every create stage is read outside production", () => {
  for (const stage of [
    "create-empty",
    "create-wallet",
    "create-funded",
    "create-advanced",
    "create-sheet",
    "create-wallets",
    "create-credits",
    "create-avatar",
  ]) {
    assert.equal(stageFromSearch("development", stage), stage);
  }
});

test("the old brief stages are gone", () => {
  assert.equal(stageFromSearch("development", "brief-done"), undefined);
});
```

- [ ] **Step 2: Implement**

In `stage.ts`, replace `BRIEF_STAGES` and `isBriefStage` with:

```ts
/** The create screen at each moment of the "Pickler Studio Empty v5" canvas (studio-create-simplified-v1 §7). */
const CREATE_STAGES = [
  "create-empty",
  "create-wallet",
  "create-funded",
  "create-advanced",
  "create-sheet",
  "create-wallets",
  "create-credits",
  "create-avatar",
] as const;
export type CreateStage = (typeof CREATE_STAGES)[number];
export const isCreateStage = (stage: StudioStage | undefined): stage is CreateStage =>
  (CREATE_STAGES as readonly string[]).includes(stage ?? "");
```

Update `StudioStage`, `stageFromSearch` and the file's top comment accordingly. Keep `"empty"`
and `"draft"`.

`fixture.ts`:

```ts
import type { StudioWallets } from "../api";
import { emptyForm, type NewAgentForm, type WalletView } from "./model";
import type { CreateStage } from "../home/stage";

/** The create screen filled in for the design harness, at one moment. Nothing is sent. */
export interface NewAgentStaged {
  form: NewAgentForm;
  available: boolean;
  wallet: WalletView | null;
  firstTime: boolean;
  wallets: StudioWallets;
  advancedOpen: boolean;
  modal: null | "wallets" | "credits" | "avatar";
  sheet: null | "create";
}

const ADDRESS = "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07";
const MASTER = "0x7f3a9C41e02bB7d5F8a16E3c90D4b27A51f0c21e";

export function newAgentFixture(stage: CreateStage): NewAgentStaged {
  const named: NewAgentForm = { ...emptyForm(), name: "Halftime", voice: "analyst" };
  const funded = stage !== "create-empty" && stage !== "create-wallet";
  const wallet: WalletView | null =
    stage === "create-empty"
      ? null
      : {
          walletId: "wal-preview",
          address: ADDRESS,
          ausdMicro: funded ? 25_000_000n : 0n,
          monWei: funded ? 500_000_000_000_000_000n : 0n,
        };
  return {
    form: stage === "create-empty" ? emptyForm() : named,
    available: true,
    wallet,
    firstTime: stage === "create-empty",
    advancedOpen: stage === "create-advanced",
    modal:
      stage === "create-wallets"
        ? "wallets"
        : stage === "create-credits"
          ? "credits"
          : stage === "create-avatar"
            ? "avatar"
            : null,
    sheet: stage === "create-sheet" ? "create" : null,
    wallets: {
      master: { address: MASTER, ausdMicro: "187600000", monWei: "4200000000000000000" },
      agents: wallet
        ? [
            {
              walletId: wallet.walletId,
              address: ADDRESS,
              agentId: null,
              agentName: null,
              caps: null,
              policiesApproved: false,
              ausdMicro: String(wallet.ausdMicro),
              monWei: String(wallet.monWei),
            },
          ]
        : [],
      readAt: 0,
    },
  };
}
```

In `studio.tsx`:

- replace the `briefFixture`, `EmptyHome` and `isBriefStage` imports with `newAgentFixture`,
  `NewAgent` and `isCreateStage`;
- `const [stagedCreate] = useState(() => (isCreateStage(stage) ? newAgentFixture(stage) : null));`
  and `const [stagedEmpty] = useState(stage === "empty" || isCreateStage(stage));`;
- extend `View` with `"new"`;
- in the render, for `landing === "empty" || section === "new"`, render `<NewAgent … staged={stagedCreate} hasAgents={agents.length > 0} onCreated={…} />`,
  passing the same props `EmptyHome` got (lines 429-440);
- replace `router.push("/studio/new")` at line 550 with `setSection("new")`.

In `menu.tsx:114`, replace the `<Link href="/studio/new">` with:

```tsx
<button
  type="button"
  className={styles.newAgent}
  onClick={() => {
    setOpen(false);
    onNew();
  }}
>
  + New agent
</button>
```

Add `onNew(): void` to `HomeMenu`'s props. Pass it from `home.tsx` (`onNew={onNew}`, threaded from
`Studio` as `() => setSection("new")`) and from `new-agent.tsx` (as `noSection`, a no-op; you are
already on it). Update the comments in `menu.tsx:49` and `home/access.ts:40` that mention
`/studio/new`.

In `NewAgent`, when `staged` is set, initialize every state from it (`form`, `availability`,
`wallet`, `advancedOpen`, `modal`, the create `sheet` in phase "idle") and skip every fetch. The
screen shows the preview note exactly as `empty.tsx:349-354` does.

In `scripts/design/routes.mjs`, replace the `studio-brief-*` entries (lines 364-387) with one entry
per create stage. Each has `product: "studio"`, `surface: "dark"` and `task: "Create v5"`:

| path                            | name                     | proves                                  |
| ------------------------------- | ------------------------ | --------------------------------------- |
| `/studio?stage=create-empty`    | `studio-create-empty`    | `#new-agent-wallet-step0`               |
| `/studio?stage=create-wallet`   | `studio-create-wallet`   | `#new-agent-wallet[data-ready="false"]` |
| `/studio?stage=create-funded`   | `studio-create-funded`   | `#new-agent-wallet[data-ready="true"]`  |
| `/studio?stage=create-advanced` | `studio-create-advanced` | `#new-agent-risk`                       |
| `/studio?stage=create-sheet`    | `studio-create-sheet`    | `dialog[open][aria-label^="Create"]`    |
| `/studio?stage=create-wallets`  | `studio-create-wallets`  | `#wallets-title`                        |
| `/studio?stage=create-credits`  | `studio-create-credits`  | `#new-agent-credits[open]`              |
| `/studio?stage=create-avatar`   | `studio-create-avatar`   | `#new-agent-avatar[open]`               |

Keep `studio-home-empty` (`/studio?stage=empty`, proves `#home-empty`) and `studio-home-draft`.

- [ ] **Step 3: Run the tests and the rendered checks**

Run: `node --import tsx --test apps/web/test/*.test.ts`
Expected: PASS, except the tests Task 12 deletes (`studio-brief*.test.ts` and the `studio-create-*`
tests), which may now fail to import. Delete those in Task 12; don't fix them.

Run: `npm run design:source`
Expected: `source: clean`.

Run: `npm run design:check` (about 8 minutes; it starts its own servers, so stop any server you
started first).
Expected: no route BLOCKED, and tokens, contrast, type and surfaces clean. If contrast flags an
element mid-animation, re-run `node scripts/design/run.mjs contrast --strict` alone before
treating it as real.

- [ ] **Step 4: Commit**

```bash
git commit -m "Studio: the create screen replaces the brief home; \"+ New agent\" opens it; design stages for each moment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/features/studio/new-agent/fixture.ts apps/web/src/features/studio/new-agent/new-agent.tsx apps/web/src/features/studio/home/stage.ts apps/web/src/features/studio/studio.tsx apps/web/src/features/studio/home/menu.tsx apps/web/src/features/studio/home/home.tsx apps/web/src/features/studio/home/access.ts scripts/design/routes.mjs apps/web/test
```

(Commit only the test files you changed in this task; list them by name instead of `apps/web/test`
if others are modified.)

---

### Task 12: Delete `/studio/new`, `features/studio/create`, the brief home and the API routes only they used

**Files:**

- Move: `apps/web/src/features/studio/create/gate.ts` → `apps/web/src/features/studio/home/gate.ts`
- Delete: `apps/web/src/app/studio/new/`, `apps/web/src/features/studio/create/` (the rest), `apps/web/src/features/studio/brief/`, `apps/web/src/features/studio/home/empty.tsx`
- Delete tests: `apps/web/test/studio-ceremony.test.ts`, `studio-create-draft.test.ts`, `studio-create-flow.test.ts`, `studio-brief.test.ts`, `studio-brief-run.test.ts`; rename `studio-create-gate.test.ts` → `studio-gate.test.ts` with the new import path; fix `passkey-flow.test.ts:125` (it lists `create/create.tsx`)
- Modify: `workers/api/src/routes/studio.ts` (delete `POST /agents` and `POST /agents/draft`), `workers/api/src/container.ts` (`drafter`)
- Delete: `workers/api/test/studio-draft-route.test.ts`, `workers/api/test/container-drafter.test.ts` (if only the drafter route used it)
- Modify: `scripts/design/routes.mjs:526-600` (delete the `/studio/new?step=*` entries)

- [ ] **Step 1: Verify each deletion's reach with grep before deleting**

Run:

```bash
grep -rn "studio/create/\|features/studio/create\|/studio/new" apps/web/src apps/web/test scripts | grep -v "^apps/web/src/features/studio/create/"
grep -rn "brief/model\|brief/brief-form\|brief/paper-run\|brief/fixture\|brief/result\|home/empty" apps/web/src apps/web/test
grep -rn "draftAgent\|createAgent\b\|createAgentSchema\|draftRequestSchema\|draftResponseSchema\|agentDraftSchema\|AgentDrafter\|drafter" workers/api/src packages/core/src packages/infrastructure/src packages/api-schema/src apps/web/src
```

Expected: the web hits are only the files being deleted, plus `menu.tsx`, `studio.tsx`,
`home/access.ts` and the gate tests (already updated in Task 11, or being moved now). The API's
`createAgent` and drafter hits are only `routes/studio.ts`, `container.ts`, core
`studio/draft.ts`, `infrastructure/src/model/openai-compatible-drafter.ts` and api-schema's draft
schemas.

`StudioDirectory.createAgent` (`packages/infrastructure/src/studio/directory.ts:91`) and
`createStudioAccess().createAgent` (`packages/core/src/features/studio/access.ts:90-107`) are only
used by `POST /agents`. Delete them too, with their tests in `packages/infrastructure/test` and
`packages/core/test/access.test.ts`. Grep each test for `createAgent(` first.

Leave the AI drafter (`openai-compatible-drafter.ts`, core `draft.ts`) **in place** if anything
else imports it (`grep -rn "openai-compatible-drafter\|from \"./features/studio/draft" packages`).
If nothing does, delete it and its export lines in `packages/infrastructure/src/index.ts` and
`packages/core/src/index.ts:183`, with its tests.

- [ ] **Step 2: Move the gate, delete the files**

```bash
git mv apps/web/src/features/studio/create/gate.ts apps/web/src/features/studio/home/gate.ts
git mv apps/web/test/studio-create-gate.test.ts apps/web/test/studio-gate.test.ts
git rm -r apps/web/src/app/studio/new apps/web/src/features/studio/create apps/web/src/features/studio/brief apps/web/src/features/studio/home/empty.tsx
git rm apps/web/test/studio-ceremony.test.ts apps/web/test/studio-create-draft.test.ts apps/web/test/studio-create-flow.test.ts apps/web/test/studio-brief.test.ts apps/web/test/studio-brief-run.test.ts
```

Fix the imports:

- `home/gate.ts` imports `"../home/status"` and `"../lib/select"`; make them `"./status"` and
  `"../lib/select"`;
- `menu.tsx:6` and `studio.tsx:28` import `"../create/gate"` / `"./create/gate"`; make them
  `"./gate"` / `"./home/gate"`;
- update the import in `apps/web/test/studio-gate.test.ts` to `../src/features/studio/home/gate`.

Update the gate's doc comment: "Both entries lead to `/studio/new`" becomes "Both entries open the
create screen". Remove `create/create.tsx` from `passkey-flow.test.ts:125`'s list.

- [ ] **Step 3: Delete the API routes**

In `workers/api/src/routes/studio.ts`, delete `api.post("/agents", …)` (line 426) and
`api.post("/agents/draft", …)` (line 455). Delete `drafter` from `StudioServices` (line 92) and its
`DraftUnavailableError` import if unused. Delete the `"/agents"`-only schemas from the import
list: `createAgentSchema`, `draftRequestSchema` and `draftResponseSchema`.

In `container.ts:409`, delete `drafter: drafter(env)` and the `drafter` function if unused.

Delete the now-unused exports from `packages/api-schema/src/studio.ts`: `createAgentSchema` (line
75), `agentDraftSchema` and `draftRequestSchema`/`draftResponseSchema` (lines 220-258), and the
helpers they alone use. Grep each with
`grep -rn "<name>" packages apps workers --include=*.ts` first.

In `apps/web/src/features/studio/api.ts`, delete `draftAgent`, `createAgent`, `startPreviewRun`,
`readPreviewRun` and their types (lines 94-134) if nothing else imports them. Grep first.

In `scripts/design/routes.mjs`, delete every `/studio/new?step=*` entry (lines 526-600) and the
comment that introduces them.

- [ ] **Step 4: Run everything that could break**

Run: `npm run build:shared >/dev/null && npm run typecheck && npm run lint && node --import tsx --test apps/web/test/*.test.ts workers/api/test/*.test.ts packages/core/test/*.test.ts`
Expected: PASS.

Run: `npm run check:architecture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "Studio: one creation flow: /studio/new, the brief home and the routes only they used are gone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src apps/web/test workers/api/src workers/api/test packages/api-schema/src packages/core/src packages/core/test packages/infrastructure/src packages/infrastructure/test scripts/design/routes.mjs
```

(Use the exact list of touched paths from `git status --short` instead of whole directories if
anything else is modified in them.)

---

### Task 13: Full verification

**Files:** none new (fixes only, if a check fails).

- [ ] **Step 1: The whole suite**

Run: `npm test`
Expected: every test passes. One known flaky process test, `apps/agent-service/test/evaluation-entry.test.ts`
("canonical entry rejects paid work"), can time out under load. If it fails, re-run it alone with
`node --import tsx --test apps/agent-service/test/evaluation-entry.test.ts`. It must pass alone.

- [ ] **Step 2: The static checks**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run design:source && npm run check:staging && npm run build:workers && npm run check:architecture`
Expected: all exit 0. On a `format:check` failure, run `npx prettier --write <files>` on the files
it names, then re-run.

- [ ] **Step 3: The rendered checks**

Stop any server you started (`lsof -nP -iTCP:3001,8799 -sTCP:LISTEN`). Then:

Run: `npm run design:check`
Expected: no route BLOCKED; `source`, `surfaces`, `tokens`, `contrast` and `type` clean over every
route. A contrast failure on an element at partial opacity is an animation caught mid-frame:
confirm with `node scripts/design/run.mjs contrast --strict`.

- [ ] **Step 4: Screenshots**

With the design harness's servers running (`scripts/design/fixture-api.mjs` header), capture each
`/studio?stage=create-*` at 1400 and 390 px with the harness's browser (`scripts/design/lib/browser.mjs`
`openBrowser`). Compare them against the canvas `Pickler Studio Empty v5.dc.html`: the brief column,
the wallet panel in each state, the three modals, the create sheet.

- [ ] **Step 5: Record the known leftovers**

Append to `docs/specs/studio-create-simplified-v1.md` §12 (open questions) and commit by path:

- `preview-runs` (API routes, `PostgresPreviewStore`, the research worker's preview claim,
  `pickler.preview_runs` and `preview_events`) is unused by the web after this change. Remove it
  in a separate cleanup.
- Perpl-shaped drafts depend on `perpl-agent-runtime-v1` to run.
- The deposit routes were not rewrapped as transfers (they share `checkStampedTransfer`).

```bash
git commit -m "Specs: simplified creation, the known leftovers after the build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/specs/studio-create-simplified-v1.md
```

---

## Self-review

**Spec coverage:**

| Spec section                                       | Task                                |
| -------------------------------------------------- | ----------------------------------- |
| D1 one flow                                        | 11, 12                              |
| D2 no paper run                                    | 4, 12                               |
| D3 the wallet first, two signatures the first time | 3, 6, 7                             |
| D4 minimums                                        | 1, 3, 4, 5                          |
| D5 Create signs the policies                       | 6                                   |
| D6 honest copy                                     | 6 (risk sub), 7 (create sheet copy) |
| D7 pull back                                       | 3, 8                                |
| D8 voice                                           | 1, 6                                |
| D9 avatar                                          | 1, 2, 10                            |
| D10 starter caps                                   | 1, 5                                |
| D11 credits                                        | 9                                   |
| D12 transfers                                      | 3, 4, 8                             |
| §4.1 changed routes                                | 4                                   |
| §4.2 new routes                                    | 4                                   |
| §4.3 deleted routes                                | 12                                  |
| §5 migration                                       | 2                                   |
| §7 preview states                                  | 11                                  |
| §9 tests                                           | every task; 13 runs all             |

Gaps flagged rather than built:

- the deposit wrappers (decision 4 above);
- the transfer rate limit (spec §8: 20 a minute), not implemented because the studio routes have no
  per-route limiter today. Check with `grep -rn "rateLimit\|RATE_LIMIT" workers/api/src/routes/studio.ts`;
  if one exists, apply it to `/wallets/transfers/prepare` in Task 4.

**Type consistency:** `TransferRequest` (core, `amount: bigint`) and `TransferRequestDto` (api-schema,
`amount: string`) are converted by `baseUnitsOf` in the route. `WalletView` (web, bigints) is parsed
from `StudioWallets` (strings). `createWallet` and `createAgent` match the `WalletDeps` and
`CreateDeps` the tests define. `StudioDirectory.createDraft` has the same signature in core
(Task 4, Step 4) and infrastructure. `prepareAgentWallet(userId)` and
`confirmAgentWallet(userId, signed)` match in core, the signing route and the web's
`prepareWallet()` and `confirmWallet(signed)`.

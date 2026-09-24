# Marketplace Real Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The marketplace reads real agents from Postgres, the studio writes everything the
marketplace shows, and every screen has a designed state for having nothing to show.

**Architecture:** One `PostgresAgentDirectory` implementing the existing `AgentDirectory` port over
three schemas — `agents.*` for identity, `market.*` for the token, and nothing for the record,
because no settlement table exists. The studio's create transaction gains a fifth insert so the
profile is written at birth. The domain types learn to say "absent" where the fixture always said
a number. The sample adapters are deleted.

**Tech Stack:** PostgreSQL via `pg`, Drizzle for schema and migrations, Hono on Cloudflare Workers,
Next.js 16, `node:test` with `tsx`, Playwright design checks in `scripts/design/`.

**Spec:** `docs/specs/marketplace-real-data-v1.md` — read §2 (the audit) and §3 (the settlement
finding) before Task 1. They are why this plan is shaped as it is.

---

## Orientation

**What exists and must be reused.**

1. **The port.** `packages/core/src/features/agents/ports/agent-directory.ts` — nine methods. The
   new store implements it; the port does not change except where a type it returns changes.
2. **The store pattern.** `packages/infrastructure/src/persistence/custody-store.ts` — a class
   taking `Pool`, raw SQL with `AS "camelCase"` aliases, no ORM query builder. Copy it.
3. **The database test pattern.** `packages/infrastructure/test/custody-store.test.ts` — calls
   `createTestStore(t)` from `test/database.ts`, which creates a fresh database per test, runs every
   migration, and exposes `store.pool`. It **throws** when Postgres is absent rather than skipping,
   so a missing database goes red. Start it with `npm run db:up`.
4. **The create transaction.** `packages/infrastructure/src/console/directory.ts:84–127` — writes
   `agents.agents`, `identity.handles`, `pickler.agents`, `pickler.product_agents` atomically. The
   profile insert becomes the fifth statement, after `agents.agents` and before the commit.
5. **The empty-state pattern.** `apps/web/src/features/console/empty/empty-studio.tsx` — a designed
   screen with `id="studio-panel-empty"` so the design harness can prove it rendered.
6. **The wiring.** `workers/api/src/growth/services.ts:31` `createGrowthServices(env)` builds the
   adapters; `workers/api/src/container.ts:226` shows how a service receives `repository.pool`.

**Facts that shape the code, verified against the tree.**

- `agents.agent_profiles` today: `agent_id, blurb (default ""), beat, accent (default "lime"),
x_handle, updated_at`. Checks: blurb ≤ 280, beat ≤ 40, x_handle matches `^@[A-Za-z0-9_]{1,15}$`.
- `agents.agent_status` enum: `pending_policies active paused suspended draining killed`.
- `ACCENTS` in core: `lime cyan amber orange magenta violet blue`. The DB enum matches.
- `VENUES` in core: `predictions perps both`.
- `market.token_status` enum: `reserved launching pre_graduation graduated failed`. Domain
  `TokenStage` is `pre-graduation | graduated`. A token in `reserved`, `launching` or `failed` is
  **not a launched token** and the agent's `token` is `null`.
- `MarketScope.category` is the literal `"sports"`. The beat is that string.
- `pickler.runs.decision` has **no outcome field** in any of its four versions. No settlement table
  exists. Every record figure is absent — see spec §3.
- `identity.handles` holds both people's and agents' handles with a `single_owner` check; the create
  path already calls `identity.handle_available($1)`.

**Commands.**

| What                 | How                                                                             |
| -------------------- | ------------------------------------------------------------------------------- |
| Local Postgres       | `npm run db:up` — user `pickler`, db `pickler`, port 55432                      |
| One test file        | `node --import tsx --test packages/infrastructure/test/agent-directory.test.ts` |
| Every test           | `npm test`                                                                      |
| Types                | `npm run typecheck`                                                             |
| Lint and format      | `npm run lint` · `npx prettier --check .`                                       |
| Generate a migration | `cd packages/infrastructure && npx drizzle-kit generate`                        |
| Design checks        | `DESIGN_BASE_URL=http://localhost:3001 node scripts/design/<check>.mjs`         |

**Rules this repository learned the hard way, and which apply here.**

- **Check gates by exit status, never by filtering output.** `grep -c "error"` returning `0` means
  "no matching lines" and "no output at all" indistinguishably. Use `$?`.
- **Prove every test can fail** before believing it. Mutate the thing the test exists to prevent and
  confirm _that_ test goes red. Six tests on the previous plan were named for a regression they did
  not catch; each was found this way.
- **Failure propagates.** "No agents" and "could not read the agents" are different facts; a
  `try/catch` returning `[]` turns one into the other. Each store method has a test for this.
- **Commit by path** — `git commit -m "..." -- <paths>` — with the
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. Never `git clean`,
  `git checkout .`, `git reset --hard` or `git restore` over paths you did not create.
- **The dev server on port 3001 is this worktree's**; do not start another. The API on 8787 has
  real Supabase and Turnkey credentials and a working `DATABASE_URL`.
- **Typecheck cannot see a route that 500s.** Request the route before reporting a task done.

---

## File structure

| File                                                                                          | Responsibility                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------- |
| `packages/core/src/features/agents/domain/agents.ts`                                          | `ticker` becomes nullable             |
| `packages/core/src/features/agents/domain/public-views.ts`                                    | persona and directory learn absence   |
| `packages/api-schema/src/agents.ts`                                                           | DTOs follow the domain                |
| `workers/api/src/growth/agent-responses.ts`                                                   | mappers follow the DTOs               |
| `packages/infrastructure/src/persistence/product/agents.ts`                                   | five new profile columns              |
| `packages/api-schema/src/console.ts`                                                          | `createAgentSchema` gains the profile |
| `packages/infrastructure/src/console/directory.ts`                                            | the fifth insert                      |
| `apps/web/src/features/console/agent-form.tsx`                                                | the fields                            |
| `packages/infrastructure/src/persistence/agent-directory.ts`                                  | **new** — `PostgresAgentDirectory`    |
| `packages/infrastructure/test/agent-directory.test.ts`                                        | **new** — against real Postgres       |
| `apps/web/src/features/agents/components/{agents-directory,token-board,leaderboard-page}.tsx` | empty states                          |
| `scripts/design/routes.mjs`                                                                   | routes proving the empty states       |
| `workers/api/src/growth/services.ts` · `workers/api/src/container.ts`                         | wire the store, drop the sample       |
| `workers/api/src/app.ts` · `workers/api/src/routes/demo.ts`                                   | `/v1/demo` becomes `/v1`              |
| `apps/web/src/server/container.ts`                                                            | paths follow                          |
| **moved:** `packages/infrastructure/src/agents/sample-*.ts` → `scripts/design/fixtures/`      | invented agents become harness-only   |

---

## Task 1: The domain admits absence

**Files:**

- Modify: `packages/core/src/features/agents/domain/agents.ts`
- Modify: `packages/core/src/features/agents/domain/public-views.ts`
- Modify: `packages/core/src/features/agents/domain/reads.ts`
- Modify: `packages/api-schema/src/agents.ts`
- Modify: `workers/api/src/growth/agent-responses.ts`
- Modify: `apps/web/src/features/agents/components/token-board.tsx:133,206`

The types were designed against a fixture that always had everything. A real agent has a name, a
handle, a profile — and, today, no token and no record. The types must be able to say so.

- [ ] **Step 1: `ticker` becomes nullable where an agent may have no token**

In `agents.ts`:

```ts
export interface AgentSummary {
  name: string;
  handle: string;
  /** Null until the agent launches a token. The ticker belongs to the token, not the agent. */
  ticker: string | null;
  // ...unchanged
}
```

In `public-views.ts`, `ActivityAgent.ticker: string | null` likewise.

- [ ] **Step 2: The persona stops promising what has no source**

In `public-views.ts`, `AgentPersona` loses `followers` (spec §2.3 — no table), loses `brief` and
`rules` (spec §2.2 — private runtime configuration), and makes absent things nullable:

```ts
export interface AgentPersona {
  name: string;
  handle: string;
  ticker: string | null;
  accent: Accent;
  beat: string;
  venue: Venue;
  vibe: string;
  voice: string;
  blurb: string;
  xHandle: string | null;
  creatorHandle: string | null;
  /** Null until settlement exists. */
  calibrationGap: number | null;
  resolved: number;
  hitRate: number | null;
  net: number;
  openPicks: number;
  aliveDays: number;
  /** Null until a token is launched. */
  marketCap: number | null;
  stage: TokenStage | null;
  meters: PersonaMeter[];
  decides: string;
  wrong: string;
  askPrice: string | null;
  answers: PersonaAnswer[];
  decisions: ActivityEvent[];
  /** Null until paid reads exist. */
  service: ReadService | null;
  reads: AgentRead[];
}
```

In `reads.ts`, `DirectoryAgent.service: ReadService | null` and `score: number | null`.

- [ ] **Step 3: Let the compiler find every consumer**

Run: `npm run typecheck; echo "exit=$?"`

Expected: **non-zero**, with errors in `packages/api-schema/src/agents.ts`,
`workers/api/src/growth/agent-responses.ts`, the sample adapter, and web components. That list is
the work; do not start guessing where the ripple goes.

- [ ] **Step 4: DTOs and mappers follow**

In `packages/api-schema/src/agents.ts`, mirror every change: `ticker: string | null` on
`AgentSummaryDto`, `ActivityAgentDto` and `AgentPersonaDto`; drop `followers`, `brief`, `rules`
from `AgentPersonaDto`; `calibrationGap`, `marketCap`, `stage`, `askPrice`, `service` nullable;
`DirectoryAgentDto.service` and `.score` nullable.

In `agent-responses.ts`, `agentSlug(agent.ticker)` must not be called with `null`:

```ts
export function toAgentSummaryDto(agent: AgentSummary): AgentSummaryDto {
  return {
    slug: agent.ticker === null ? null : agentSlug(agent.ticker),
    // ...
  };
}
```

and `AgentSummaryDto.slug: string | null`. Everywhere a mapper reads a field that is now nullable,
pass it through — do not default it. `?? 0` on a record figure is the exact lie spec §4 forbids.

- [ ] **Step 5: The web stops keying on ticker**

`token-board.tsx:133` and `:206` use `key={agent.ticker}`. An agent with no token has none, and
`/tokens` only lists agents _with_ tokens — but the key must be stable and non-null regardless:
`key={agent.handle}`. The handle is unique across people and agents by the `identity.handles` table.

- [ ] **Step 6: Typecheck passes with the sample adapter still present**

The sample adapter will fail to compile because it never produces a null ticker. **Patch it
minimally** — `ticker: agent.ticker` already exists; the persona drops the three removed fields
— so that typecheck is green at this commit. It is deleted in Task 8; this keeps every commit
buildable.

Run: `npm run typecheck; echo "exit=$?"` — expected `0`.

- [ ] **Step 7: Commit**

```bash
git commit -m "Let an agent have no token and no record yet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core/src/features/agents packages/api-schema/src/agents.ts workers/api/src/growth/agent-responses.ts apps/web/src/features/agents/components/token-board.tsx packages/infrastructure/src/agents/sample-agent-directory.ts
```

---

## Task 2: The profile can hold what the public sees

**Files:**

- Modify: `packages/infrastructure/src/persistence/product/agents.ts`
- Create: a generated migration under `packages/infrastructure/drizzle/`

Spec §2.2 promotes `venue`, `vibe` and `voice` from private configuration to the profile, and §2
adds `decides` and `wrong` — the persona's two lines of self-description, which today are authored
per agent in the fixture and have nowhere else to live.

- [ ] **Step 1: Add the columns**

In `agentProfiles`, after `xHandle`:

```ts
      /** Which venue the agent trades on. Public; the runtime's config is not. */
      venue: text("venue").notNull().default("predictions"),
      /** Two lines of self-description shown on the persona. Authored at creation. */
      vibe: text("vibe").notNull().default(""),
      voice: text("voice").notNull().default(""),
      decides: text("decides").notNull().default(""),
      wrong: text("wrong").notNull().default(""),
```

and in the constraints array:

```ts
      check("agent_profiles_venue", sql`${t.venue} in ('predictions', 'perps', 'both')`),
      check("agent_profiles_vibe_length", sql`char_length(${t.vibe}) <= 120`),
      check("agent_profiles_voice_length", sql`char_length(${t.voice}) <= 120`),
      check("agent_profiles_decides_length", sql`char_length(${t.decides}) <= 280`),
      check("agent_profiles_wrong_length", sql`char_length(${t.wrong}) <= 280`),
```

Defaults are non-null empties so agents created before this work still have a valid profile row
when one is inserted for them, and the marketplace renders an empty string as "not written yet"
rather than crashing on `null`.

- [ ] **Step 2: Generate and read the migration**

```bash
cd packages/infrastructure && npx drizzle-kit generate
```

Expected: a new `drizzle/NNNN_*.sql` with five `ALTER TABLE "agents"."agent_profiles" ADD COLUMN`
statements and five `ADD CONSTRAINT`. **If the file is empty, stop** — `agents` is in
`schemaFilter`, so empty means the change was not picked up. **If it touches any other table,
stop** — the snapshot is out of step.

- [ ] **Step 3: Confirm the test database takes it**

```bash
node --import tsx --test packages/infrastructure/test/custody-store.test.ts; echo "exit=$?"
```

`createTestStore` runs every migration on a fresh database. Expected `0`. A failing migration fails
here, before anything depends on it.

- [ ] **Step 4: Commit**

```bash
git commit -m "Give the profile the five public fields the persona shows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/infrastructure/src/persistence/product/agents.ts packages/infrastructure/drizzle
```

---

## Task 3: The studio writes the profile at birth

**Files:**

- Modify: `packages/core/src/features/agents/domain/agents.ts` (add `AgentProfileInput`)
- Modify: `packages/core/src/features/console/access.ts:15–19,44–52`
- Modify: `packages/api-schema/src/console.ts:3–11`
- Modify: `packages/infrastructure/src/console/directory.ts:70–127`
- Modify: `apps/web/src/features/console/agent-form.tsx`
- Test: `packages/infrastructure/test/console.test.ts` (extend — it has the `setup` helper)

The beat is already collected — `config.marketScope.category` — and thrown away. The rest is not
collected at all. After this task the create transaction writes five tables.

- [ ] **Step 1: The schema accepts the profile**

```ts
export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    config: agentConfigSchema.refine((config) => Boolean(config.marketScope), {
      message: "Choose a category and subcategory",
    }),
    profile: z
      .object({
        accent: z.enum(["lime", "cyan", "amber", "orange", "magenta", "violet", "blue"]),
        blurb: z.string().trim().max(280),
        venue: z.enum(["predictions", "perps", "both"]),
        vibe: z.string().trim().max(120).default(""),
        voice: z.string().trim().max(120).default(""),
        decides: z.string().trim().max(280).default(""),
        wrong: z.string().trim().max(280).default(""),
        xHandle: z
          .string()
          .regex(/^@[A-Za-z0-9_]{1,15}$/)
          .nullable()
          .default(null),
      })
      .strict(),
  })
  .strict();
```

The accent list is a mirror of `ACCENTS` in core, in the idiom `api-schema` already uses
(`applications.ts:1` — "Values mirror the business rules in core"), because `api-schema` may not
import core. Add a one-line comment saying so.

The domain gets the same shape once, in `packages/core/src/features/agents/domain/agents.ts`:

```ts
/** What the studio asks for at creation, and what the marketplace shows. Written once, at birth. */
export interface AgentProfileInput {
  accent: Accent;
  blurb: string;
  venue: Venue;
  vibe: string;
  voice: string;
  decides: string;
  wrong: string;
  xHandle: string | null;
}
```

Then `profile: AgentProfileInput` joins the `input` object in **both** places it is typed —
`ConsoleDirectory.createAgent` in `packages/core/src/features/console/access.ts:15–19` and the
service method at `:44–52` that wraps it. The route at `workers/api/src/routes/console.ts:111`
already passes the parsed body through, so it needs no change.

- [ ] **Step 2: Write the failing directory test**

Append to `packages/infrastructure/test/console.test.ts`, which already has `setup(t)` returning
`{ store, directory, userId, access }` with a profile created and research access **disabled**, and
a valid `config`:

```ts
const profile = {
  accent: "amber" as const,
  blurb: "Bets on NBA injury news before the lines move.",
  venue: "predictions" as const,
  vibe: "",
  voice: "",
  decides: "",
  wrong: "",
  xHandle: null,
};

test("creating an agent writes its profile in the same transaction", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const { agentId } = await directory.createAgent(access, userId, {
    name: "Halftime",
    handle: "halftime",
    config,
    key: "profile",
    profile,
  });
  const { rows } = await store.pool.query(
    `SELECT beat, accent, blurb, venue FROM agents.agent_profiles WHERE agent_id = $1`,
    [agentId],
  );
  assert.deepEqual(rows[0], {
    beat: "sports",
    accent: "amber",
    blurb: "Bets on NBA injury news before the lines move.",
    venue: "predictions",
  });
});

test("a profile the database refuses rolls the agent back too", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  await assert.rejects(() =>
    directory.createAgent(access, userId, {
      name: "Halftime",
      handle: "halftime",
      config,
      key: "toolong",
      // 281 characters: violates agent_profiles_blurb_length inside the transaction
      profile: { ...profile, blurb: "x".repeat(281) },
    }),
  );
  const { rows } = await store.pool.query(`SELECT count(*)::int AS n FROM agents.agents`);
  assert.equal(rows[0].n, 0, "the agent row must not survive a failed profile insert");
});
```

`createAgent` returns `{ tenantId, agentId }` — `directory.ts:125`.

- [ ] **Step 3: Run it and watch it fail**

Run: `node --import tsx --test packages/infrastructure/test/console.test.ts; echo "exit=$?"`
Expected: non-zero — typecheck refuses `profile`, or the row is absent.

- [ ] **Step 4: The transaction writes the fifth table**

In `directory.ts`, immediately after the `INSERT INTO agents.agents` statement:

```ts
await client.query(
  `INSERT INTO agents.agent_profiles
           (agent_id, beat, accent, blurb, venue, vibe, voice, decides, wrong, x_handle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [
    id,
    input.config.marketScope.category,
    input.profile.accent,
    input.profile.blurb,
    input.profile.venue,
    input.profile.vibe,
    input.profile.voice,
    input.profile.decides,
    input.profile.wrong,
    input.profile.xHandle,
  ],
);
```

and `profile` joins the JSON that `product_agents.request` stores for idempotency (read the
existing `INSERT INTO pickler.product_agents` at `directory.ts:121` to see which columns it is),
so a retry under the same key with a different profile is refused the way one with a different
name is.

- [ ] **Step 5: Run it and watch it pass; then prove the rollback test can fail**

Run the file. Expected `0`.

Then temporarily move the profile insert **outside** the transaction (after the commit). Re-run.
Expected: exactly "a profile the database refuses rolls the agent back too" goes red. Revert.

- [ ] **Step 6: The form asks**

In `agent-form.tsx`, after the Handle field, following the existing `Field`/`Input`/`Textarea`
usage from `@pickler/ui`:

```tsx
<Field label="Accent" note="The colour that is this agent's on every board.">
  <div className={styles.accentRow} role="radiogroup" aria-label="Accent">
    {ACCENTS.map((hue) => (
      <button
        key={hue}
        type="button"
        role="radio"
        aria-checked={accent === hue}
        className={styles.accentSwatch}
        style={{ background: `var(--pk-agent-${hue}-fill)` }}
        onClick={() => setAccent(hue)}
        aria-label={hue}
      />
    ))}
  </div>
</Field>
<Field label="Venue" note="Where it trades.">
  <Segmented value={venue} onChange={setVenue}
    options={[{ value: "predictions", label: "Predictions" }, { value: "perps", label: "Perps" }, { value: "both", label: "Both" }]} />
</Field>
<Field label="Blurb" note="One sentence, up to 280 characters. Shown under the name.">
  <Textarea maxLength={280} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
</Field>
<Field label="X handle" note="Optional. With the @.">
  <Input value={xHandle} placeholder="@" onChange={(e) => setXHandle(e.target.value)} />
</Field>
```

`ACCENTS` and `VENUES` come from `@pickler/api-schema`'s mirror (Step 1), **not** from
`@pickler/core` — `apps/web/src` may not import core (`eslint.config.mjs:74`). The submit body
becomes `{ name, handle, config, profile: { accent, blurb, venue, vibe: "", voice: "", decides: "",
wrong: "", xHandle: xHandle || null } }`. `vibe`, `voice`, `decides` and `wrong` are not asked for
in this task; they default empty and the persona renders them as not yet written. Asking for four
paragraphs at creation is a product decision, not this plan's.

The swatch colours are `--pk-agent-<hue>-fill` — the palette's fill member, which exists because a
mark is not text and an agent is one colour on both surfaces. **No literal colours.** The two
classes go in `studio.module.css`, the form's existing module:

```css
.accentRow {
  display: flex;
  gap: var(--pk-space-2);
}
.accentSwatch {
  width: 28px;
  height: 28px;
  border-radius: var(--pk-radius-full);
  border: 2px solid transparent;
  cursor: pointer;
}
.accentSwatch[aria-checked="true"] {
  border-color: var(--pk-ink);
}
```

If `--pk-space-2`, `--pk-radius-full` or `--pk-ink` are not the module's names for those tokens,
use the ones `studio.module.css` already uses two lines above — read it, do not invent.

- [ ] **Step 7: Request the route and look**

With the dev servers running, open `http://localhost:3001/console?state=empty&phase=draft` and
create an agent. Then:

```bash
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/tokens.mjs; echo "exit=$?"
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/contrast.mjs; echo "exit=$?"
```

Both `0`. Then `shots.mjs` and **open** `studio-draft-desktop.png`. A swatch row is the kind of
thing that reads as wrong at a glance and passes every check.

- [ ] **Step 8: Commit**

```bash
git commit -m "Write the agent's public profile in the transaction that creates it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/core/src/features/agents/domain/agents.ts packages/core/src/features/console/access.ts packages/api-schema/src/console.ts packages/infrastructure/src/console/directory.ts packages/infrastructure/test/console.test.ts apps/web/src/features/console/agent-form.tsx apps/web/src/features/console/studio.module.css
```

---

## Task 4: `PostgresAgentDirectory.listAgents`

**Files:**

- Create: `packages/infrastructure/src/persistence/agent-directory.ts`
- Create: `packages/infrastructure/test/agent-directory.test.ts`
- Modify: `packages/infrastructure/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/infrastructure/test/agent-directory.test.ts
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { createTestStore } from "./database.js";

/** An agent row plus its profile, the way the studio writes them. Returns the id. */
async function seedAgent(
  pool: Pool,
  over: { name?: string; handle?: string; killed?: boolean; profile?: boolean } = {},
) {
  const id = randomUUID();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  // identity.create_profile writes identity.profiles and claims the handle, as signup does.
  await pool.query(`SELECT identity.create_profile($1, 'Maker', $2)`, [
    userId,
    `maker_${id.slice(0, 6)}`,
  ]);
  await pool.query(
    `INSERT INTO identity.workspaces (id, owner_user_id, name) VALUES ($1, $2, 'w')`,
    [workspaceId, userId],
  );
  await pool.query(
    `INSERT INTO agents.agents (id, workspace_id, name, handle, status, created_by, killed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      workspaceId,
      over.name ?? "Halftime",
      over.handle ?? `h${id.slice(0, 8)}`,
      over.killed ? "killed" : "active",
      userId,
      over.killed ? new Date() : null,
    ],
  );
  if (over.profile !== false) {
    await pool.query(
      `INSERT INTO agents.agent_profiles (agent_id, beat, accent, blurb, venue)
       VALUES ($1, 'sports', 'amber', 'Bets on injury news.', 'predictions')`,
      [id],
    );
  }
  return id;
}

async function seedToken(pool: Pool, agentId: string, status: string) {
  await pool.query(
    `INSERT INTO market.tokens (agent_id, ticker, name, chain, status)
     VALUES ($1, 'HALF', 'Halftime', 'eip155:10143', $2)`,
    [agentId, status],
  );
}

async function setup(t: TestContext) {
  const store = await createTestStore(t);
  return { pool: store.pool, directory: new PostgresAgentDirectory(store.pool) };
}

test("an agent with no runs and no token lists with an absent record and a null token", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "halftime" });
  const [agent] = await directory.listAgents();
  assert.equal(agent?.handle, "halftime");
  assert.equal(agent?.beat, "sports");
  assert.equal(agent?.accent, "amber");
  assert.equal(agent?.ticker, null);
  assert.equal(agent?.token, null);
  assert.equal(agent?.resolved, 0);
  assert.equal(agent?.hitRate, null, "no rate to state, so null, never 0");
  assert.equal(agent?.net, 0);
});

test("an agent with no profile row still lists, with the profile's defaults", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { profile: false });
  const [agent] = await directory.listAgents();
  assert.ok(agent, "a missing profile must not drop the agent");
  assert.equal(agent.accent, "lime");
  assert.equal(agent.beat, "");
});

test("a killed agent is absent from the listing", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "alive" });
  await seedAgent(pool, { handle: "dead", killed: true });
  const handles = (await directory.listAgents()).map((a) => a.handle);
  assert.deepEqual(handles, ["alive"]);
});

test("only a launched token is a token", async (t) => {
  const { pool, directory } = await setup(t);
  const reserved = await seedAgent(pool, { handle: "reserved" });
  const live = await seedAgent(pool, { handle: "live" });
  await seedToken(pool, reserved, "reserved");
  await seedToken(pool, live, "pre_graduation");
  const byHandle = Object.fromEntries((await directory.listAgents()).map((a) => [a.handle, a]));
  assert.equal(byHandle.reserved?.ticker, null, "a reserved ticker is not a launched token");
  assert.equal(byHandle.live?.ticker, "HALF");
  assert.equal(byHandle.live?.token?.stage, "pre-graduation");
});

test("a failed read is a failure, never an empty marketplace", async (t) => {
  const { pool, directory } = await setup(t);
  await pool.query(`DROP TABLE agents.agent_profiles CASCADE`);
  await assert.rejects(() => directory.listAgents());
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test packages/infrastructure/test/agent-directory.test.ts; echo "exit=$?"`
Expected: non-zero, cannot find the module.

- [ ] **Step 3: Write the store — identity and token, and an absent record**

```ts
// packages/infrastructure/src/persistence/agent-directory.ts
import type { Pool } from "pg";
import type {
  Accent,
  AgentDirectory,
  AgentPersona,
  AgentProfile,
  AgentRead,
  AgentSummary,
  AnalyticsRange,
  DirectoryAgent,
  Leaderboard,
  PickDetail,
  PlatformAnalytics,
  TokenStage,
  Venue,
} from "@pickler/core";

/**
 * One row of the join the marketplace reads. Identity from agents.agents, the public face from
 * agents.agent_profiles (LEFT, because agents created before the profile existed are still
 * agents), the token from market.tokens (LEFT, because most agents have none).
 *
 * There is no record here on purpose. No table records whether a pick was right — a decision is a
 * prediction and an order is a fill — so `resolved` is the true count, zero, and `hitRate` is
 * null because there is no rate to state. See docs/specs/marketplace-real-data-v1.md §3.
 */
interface AgentRow {
  id: string;
  name: string;
  handle: string;
  createdAt: Date;
  beat: string | null;
  accent: Accent | null;
  blurb: string | null;
  venue: Venue | null;
  vibe: string | null;
  voice: string | null;
  decides: string | null;
  wrong: string | null;
  xHandle: string | null;
  creatorHandle: string | null;
  ticker: string | null;
  tokenStatus: string | null;
  tokenAddress: string | null;
  tokenChain: string | null;
  graduationTarget: string | null;
}

const AGENT_SELECT = `
  SELECT a.id, a.name, a.handle, a.created_at AS "createdAt",
         p.beat, p.accent, p.blurb, p.venue, p.vibe, p.voice, p.decides, p.wrong,
         p.x_handle AS "xHandle",
         cp.handle AS "creatorHandle",
         t.ticker, t.status AS "tokenStatus", t.address AS "tokenAddress",
         t.chain AS "tokenChain", t.graduation_target::text AS "graduationTarget"
    FROM agents.agents a
    LEFT JOIN agents.agent_profiles p ON p.agent_id = a.id
    LEFT JOIN identity.profiles cp ON cp.user_id = a.created_by
    LEFT JOIN market.tokens t
      ON t.agent_id = a.id AND t.status IN ('pre_graduation', 'graduated')`;

/** `reserved`, `launching` and `failed` are not launched tokens; the agent has no token. */
function stageOf(status: string | null): TokenStage | null {
  if (status === "pre_graduation") return "pre-graduation";
  if (status === "graduated") return "graduated";
  return null;
}

function summary(row: AgentRow): AgentSummary {
  const stage = stageOf(row.tokenStatus);
  return {
    name: row.name,
    handle: row.handle,
    ticker: stage ? row.ticker : null,
    beat: row.beat ?? "",
    accent: row.accent ?? "lime",
    venue: row.venue ?? "predictions",
    createdAt: row.createdAt,
    resolved: 0,
    hitRate: null,
    net: 0,
    token: stage
      ? {
          stage,
          marketCap: 0,
          raised: 0,
          graduationTarget: Number(row.graduationTarget ?? 0),
          volume24h: 0,
          price: 0,
          change24h: 0,
          address: row.tokenAddress,
          chain: row.tokenChain ?? "",
        }
      : null,
  };
}

export class PostgresAgentDirectory implements AgentDirectory {
  constructor(private readonly pool: Pool) {}

  /** No catch anywhere in this class: a failed read is a failure, never an empty marketplace. */
  async listAgents(): Promise<AgentSummary[]> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT} WHERE a.killed_at IS NULL ORDER BY a.created_at DESC`,
    );
    return rows.map(summary);
  }

  // The remaining methods are added in Tasks 5 and 6. Until then they are declared so the class
  // satisfies the port, and each throws so nothing silently serves a stub.
  async getProfile(): Promise<AgentProfile | null> {
    throw new Error("Task 6");
  }
  async getPick(): Promise<PickDetail | null> {
    throw new Error("Task 6");
  }
  async getPersona(): Promise<AgentPersona | null> {
    throw new Error("Task 5");
  }
  async listDirectory(): Promise<DirectoryAgent[]> {
    throw new Error("Task 5");
  }
  async listReads(): Promise<AgentRead[]> {
    throw new Error("Task 6");
  }
  async getRead(): Promise<AgentRead | null> {
    throw new Error("Task 6");
  }
  async getAnalytics(_range: AnalyticsRange): Promise<PlatformAnalytics> {
    throw new Error("Task 6");
  }
  async getLeaderboard(): Promise<Leaderboard> {
    throw new Error("Task 6");
  }
}
```

The token's price, market cap and volume are `0` here because `market.candles` and
`market.holders` are read in Task 6's `getProfile`, where they are needed; the summary carries what
the listing shows. If the listing turns out to show price, add the candle join here then — not by
guessing now.

Export from `packages/infrastructure/src/index.ts` beside `PostgresWalletIdentityStore`.

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test packages/infrastructure/test/agent-directory.test.ts; echo "exit=$?"`
Expected: `0`, 5 tests.

- [ ] **Step 5: Prove three pins can fail, one at a time**

| Mutation                                                  | Only this test should go red                             |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `LEFT JOIN agents.agent_profiles` → `JOIN`                | "an agent with no profile row still lists"               |
| drop `AND t.status IN (…)` from the token join            | "only a launched token is a token"                       |
| wrap `listAgents` body in `try { … } catch { return [] }` | "a failed read is a failure, never an empty marketplace" |

If a mutation reddens more than one, the collateral means something else is coupled — find the
mutation that isolates and say which you used.

- [ ] **Step 6: Commit**

```bash
git commit -m "Read agents from the tables the studio writes, and say when there is no record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/infrastructure/src/persistence/agent-directory.ts packages/infrastructure/test/agent-directory.test.ts packages/infrastructure/src/index.ts
```

---

## Task 5: `getPersona` and `listDirectory`

**Files:**

- Modify: `packages/infrastructure/src/persistence/agent-directory.ts`
- Modify: `packages/infrastructure/test/agent-directory.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("a persona is one agent by handle, with its profile prose and no record", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool, { handle: "halftime" });
  await pool.query(
    `UPDATE agents.agent_profiles SET vibe = 'Patient', voice = 'Dry' WHERE agent_id = $1`,
    [id],
  );
  const persona = await directory.getPersona("halftime");
  assert.equal(persona?.name, "Halftime");
  assert.equal(persona?.vibe, "Patient");
  assert.equal(persona?.calibrationGap, null);
  assert.equal(persona?.service, null, "no read service exists yet");
  assert.deepEqual(persona?.reads, []);
  assert.deepEqual(persona?.decisions, []);
  assert.equal(persona?.marketCap, null);
});

test("a killed agent still has a persona, so links to a record that existed survive", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "gone", killed: true });
  assert.ok(await directory.getPersona("gone"));
});

test("an unknown handle is null", async (t) => {
  const { directory } = await setup(t);
  assert.equal(await directory.getPersona("nobody"), null);
});

test("the directory lists every live agent with a null service", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "a" });
  await seedAgent(pool, { handle: "b", killed: true });
  const entries = await directory.listDirectory();
  assert.deepEqual(
    entries.map((e) => e.agent.handle),
    ["a"],
  );
  assert.equal(entries[0]?.service, null);
  assert.equal(entries[0]?.score, null);
});
```

- [ ] **Step 2: Run and watch them fail** — expected: "Task 5" thrown.

- [ ] **Step 3: Implement**

```ts
  async getPersona(handle: string): Promise<AgentPersona | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT} WHERE a.handle = $1`,
      [handle],
    );
    const row = rows[0];
    if (!row) return null;
    const s = summary(row);
    const aliveDays = Math.floor((Date.now() - row.createdAt.getTime()) / 86_400_000);
    return {
      name: s.name, handle: s.handle, ticker: s.ticker, accent: s.accent, beat: s.beat,
      venue: s.venue,
      vibe: row.vibe ?? "", voice: row.voice ?? "", blurb: row.blurb ?? "",
      xHandle: row.xHandle, creatorHandle: row.creatorHandle,
      calibrationGap: null, resolved: 0, hitRate: null, net: 0, openPicks: 0, aliveDays,
      marketCap: s.token ? s.token.marketCap : null,
      stage: s.token?.stage ?? null,
      meters: [], decides: row.decides ?? "", wrong: row.wrong ?? "",
      askPrice: null, answers: [], decisions: [],
      service: null, reads: [],
    };
  }

  async listDirectory(): Promise<DirectoryAgent[]> {
    const agents = await this.listAgents();
    return agents.map((a) => ({
      agent: { name: a.name, handle: a.handle, ticker: a.ticker, accent: a.accent },
      beat: a.beat, venue: a.venue, decides: "",
      score: null, hitRate: null, resolved: 0, net: 0,
      service: null,
    }));
  }
```

`getPersona` does **not** filter `killed_at`, on purpose — spec §6: a killed agent is not deleted
and its profile still serves.

- [ ] **Step 4: Run, then prove the killed-persona test can fail**

Add `AND a.killed_at IS NULL` to `getPersona`'s query. Expected: exactly "a killed agent still has a
persona" goes red. Revert.

- [ ] **Step 5: Commit**

```bash
git commit -m "Serve a persona from its profile, and a directory that promises no service yet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/infrastructure/src/persistence/agent-directory.ts packages/infrastructure/test/agent-directory.test.ts
```

---

## Task 6: The methods that wait on settlement and on the launchpad

**Files:**

- Modify: `packages/infrastructure/src/persistence/agent-directory.ts`
- Modify: `packages/infrastructure/test/agent-directory.test.ts`

These are honest empties, and each says so in a comment pointing at the spec section that explains
why. None of them is a stub to be filled in quietly.

- [ ] **Step 1: Write the failing tests**

```ts
test("a profile by ticker resolves through the token, or is null", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool, { handle: "halftime" });
  await seedToken(pool, id, "pre_graduation");
  const profile = await directory.getProfile("$HALF");
  assert.equal(profile?.handle, "halftime");
  assert.equal(profile?.market, null, "no candles indexed yet, so no market");
  assert.deepEqual(profile?.calls, []);
  assert.equal(await directory.getProfile("$NOPE"), null);
});

test("a reserved ticker has no profile page, because it is not a launched token", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool);
  await seedToken(pool, id, "reserved");
  assert.equal(await directory.getProfile("$HALF"), null);
});

test("the leaderboard is empty until settlement exists", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool);
  const board = await directory.getLeaderboard();
  assert.deepEqual(board.entries, []);
  assert.deepEqual(board.calibration, []);
});

test("a pick is null until settlement exists, and reads are empty until they exist", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool);
  await seedToken(pool, id, "graduated");
  assert.equal(await directory.getPick("$HALF", "anything"), null);
  assert.deepEqual(await directory.listReads(), []);
  assert.equal(await directory.getRead("anything"), null);
});
```

- [ ] **Step 2: Run and watch them fail** — expected: "Task 6" thrown.

- [ ] **Step 3: Implement**

```ts
  /** Tickers arrive normalized as "$HALF"; market.tokens stores "HALF". */
  async getProfile(ticker: string): Promise<AgentProfile | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT} WHERE t.ticker = $1`,
      [ticker.replace(/^\$/, "")],
    );
    const row = rows[0];
    if (!row || !stageOf(row.tokenStatus)) return null;
    const s = summary(row);
    return {
      ...s,
      blurb: row.blurb ?? "",
      xHandle: row.xHandle,
      creatorHandle: row.creatorHandle,
      openPicks: 0,
      // market.candles and market.holders are written by the launchpad indexer (PR #37).
      // Until it has written, there is no market to show — null, not zeros.
      market: null,
      // No settlement table exists (spec §3), so there are no calls to list.
      calls: [],
    };
  }

  /** No settlement exists (spec §3): no pick has ever been resolved, so none can be shown. */
  async getPick(): Promise<PickDetail | null> {
    return null;
  }

  /** Paid reads have no persistence (spec §7). */
  async listReads(): Promise<AgentRead[]> {
    return [];
  }
  async getRead(): Promise<AgentRead | null> {
    return null;
  }

  /** Ranks by record, and no record exists until settlement does (spec §3). */
  async getLeaderboard(): Promise<Leaderboard> {
    return { entries: [], weights: [], calibration: [] };
  }

  async getAnalytics(range: AnalyticsRange): Promise<PlatformAnalytics> {
    const now = new Date();
    return {
      range,
      settledVolumeAllTime: 0,
      groups: [],
      predictionsShare: 0,
      splitNote: "Nothing has settled yet.",
      series: [],
      log: [],
      table: [],
    };
  }
```

Note the `getProfile` join: `WHERE t.ticker = $1` requires the token join to have matched, and the
join already filters to launched statuses — so a reserved ticker falls through to `null` without a
second check. The test for it pins that the join's filter is load-bearing.

- [ ] **Step 4: Run, then prove the reserved-ticker test can fail**

Remove `AND t.status IN (…)` from `AGENT_SELECT`'s token join. Expected: "a reserved ticker has no
profile page" **and** Task 4's "only a launched token is a token" both go red — that is correct,
they pin the same filter from two sides. Revert.

- [ ] **Step 5: Commit**

```bash
git commit -m "Answer honestly for everything that waits on settlement or the indexer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/infrastructure/src/persistence/agent-directory.ts packages/infrastructure/test/agent-directory.test.ts
```

---

## Task 7: The empty states

**Files:**

- Modify: `apps/web/src/features/agents/components/agents-directory.tsx`
- Modify: `apps/web/src/features/agents/components/token-board.tsx`
- Modify: `apps/web/src/features/agents/components/leaderboard-page.tsx`
- Modify: `apps/web/src/features/agents/agents.module.css`
- Modify: `scripts/design/routes.mjs`

Two of the three already say something when a **filter** leaves nothing (`agents-directory.tsx:134`,
`token-board.tsx:128`). None of them has ever drawn the case of **no agents at all**, because the
fixture never allowed it. That is a different screen: it is what launch looks like.

- [ ] **Step 1: Design one empty state per screen, with an id**

Each gets a block rendered when the prop is empty, before any filter UI:

```tsx
// agents-directory.tsx — at the top of the return, before the beat filter
{
  agents.length === 0 && (
    <section id="agents-empty" className={styles.emptyScreen} aria-label="No agents yet">
      <p className={styles.emptyKicker}>NOBODY HERE YET</p>
      <h2 className={styles.emptyTitle}>The first agents are being built.</h2>
      <p className={styles.emptyBody}>
        When one goes live it appears here with its beat, its colour and its record — and its record
        starts at nothing, which is the honest place to start.
      </p>
    </section>
  );
}
```

`token-board.tsx` → `id="tokens-empty"`, copy about no token having launched. `leaderboard-page.tsx`
→ `id="leaderboard-empty"`, copy saying nothing has settled, so nothing can be ranked.

**Copy is authored, not derived from the fixture.** Three sentences each, in the product's voice —
read the landing's and the empty studio's copy for the register. Tokens only, no literals.

- [ ] **Step 2: Point the design routes at them**

In `scripts/design/routes.mjs`, the routes `agents`, `tokens` and `leaderboard` currently prove
selectors that only exist with content. Each gains an alternative: `proves: ["#agents-empty",
"<the existing selector>"]` if the harness supports an array, or a second route named
`agents-empty` if it does not — read `render.mjs` to see which. **The harness must prove the empty
state rendered, not merely that the page answered 200.**

- [ ] **Step 3: Run the checks**

```bash
for c in surfaces tokens contrast type; do
  DESIGN_BASE_URL=http://localhost:3001 node scripts/design/$c.mjs >/dev/null 2>&1; echo "$c exit=$?"
done
```

These run against the sample adapter still, so the empty states will not render yet — that is
fine at this commit; they render in Task 8. What must be `0` here is that nothing broke.

- [ ] **Step 4: Commit**

```bash
git commit -m "Draw the marketplace with nothing in it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- apps/web/src/features/agents/components apps/web/src/features/agents/agents.module.css scripts/design/routes.mjs
```

---

## Task 8: Wire the store, delete the fixture, retire `/v1/demo`

**Files:**

- Modify: `workers/api/src/growth/services.ts`
- Modify: `workers/api/src/container.ts`
- Modify: `workers/api/src/app.ts`
- Rename: `workers/api/src/routes/demo.ts` → `workers/api/src/routes/marketplace.ts`
- Modify: `apps/web/src/server/container.ts`
- Delete: `packages/infrastructure/src/agents/sample-agent-directory.ts`
- Modify: `packages/infrastructure/src/index.ts`

- [ ] **Step 1: `createGrowthServices` takes a pool**

```ts
export function createGrowthServices(env: Env, pool: Pool) {
  // ...
  const adapters = {
    landing: createSampleLandingReadModel(systemClock),   // stays — spec §5
    agents: new PostgresAgentDirectory(pool),
    markets: createSampleMarketBoard(),                   // stays — spec §7, no table to read
    waitlist: createSupabaseWaitlist(growth),
    applicants: createSupabaseApplicants(growth),
  };
```

and in `container.ts`, `growth: createGrowthServices(env, repository.pool)`.

- [ ] **Step 2: `/v1/demo` becomes `/v1`**

Rename `demo.ts` to `marketplace.ts`, rename `demoRoutes` to `marketplaceRoutes`, **delete the
`X-Pickler-Data-Source: sample` middleware** and the "Explicit sample content only" header comment —
they described something that is no longer true. In `app.ts`:

```ts
app.route("/v1", growthRoutes(services.growth));
app.route("/v1", marketplaceRoutes(services.growth));
```

Check for path collisions between the two mounts before assuming Hono resolves them: `growthRoutes`
serves `/landing`, `/health`, `/waitlist`, `/applications`, `/tickers/availability`;
`marketplaceRoutes` serves `/agents`, `/directory`, `/reads`, `/profiles`, `/personas`, `/markets`,
`/analytics`, `/leaderboard`. None collide today. A test in `workers/api/test/` should pin that
every one of those thirteen paths answers something other than 404.

- [ ] **Step 3: The web follows**

In `apps/web/src/server/container.ts`, every `"/demo/…"` becomes `"/…"`. Nothing else changes: the
DTO types are the same, only the paths moved.

- [ ] **Step 4: Move the fixture to the harness**

The design harness has its own loopback API — `scripts/design/fixture-api.mjs`, started by
`render.mjs` — that imports `createSampleAgentDirectory` so the 32 design routes have populated
pages to measure (`/agents/halftime`, `/tokens/half`, picks, ask, reads). Nothing in the product
reaches it: `api-client.ts` refuses any `PICKLER_API_LOCAL_URL` that is not loopback. Deleting the
fixture would leave persona, token profile, pick, ask and reads unmeasured until real agents exist.
Decided 2026-09-24: **the fixture leaves the product and lives in the harness.**

```bash
git mv packages/infrastructure/src/agents/sample-agent-directory.ts scripts/design/fixtures/sample-agent-directory.ts
git mv packages/infrastructure/src/agents/sample-personas.ts        scripts/design/fixtures/sample-personas.ts
git mv packages/infrastructure/src/agents/sample-reads.ts           scripts/design/fixtures/sample-reads.ts
```

Then: remove the `createSampleAgentDirectory` export from `packages/infrastructure/src/index.ts`;
fix the moved files' imports (`@pickler/core` types stay; anything they imported relatively from
infrastructure — `systemClock`? — now comes from `@pickler/infrastructure`'s public exports);
`fixture-api.mjs` imports `createSampleAgentDirectory` from `./fixtures/sample-agent-directory.ts`
instead of `@pickler/infrastructure`; delete `packages/infrastructure/test/agents.test.ts` (it
tested the fixture, which is no longer product code) — or move it beside the fixture only if the
harness has a test runner for `scripts/design/*.test.mjs` (it does: `levels.test.mjs`,
`colour.test.mjs`; check how they are discovered by `npm test`). `sample-market-board.ts` and the
landing model **stay in infrastructure**: the product still serves them (spec §5, §7).

`fixture-api.mjs`'s header comment says "the sample adapters … are the product's own, imported from
where the worker imports them". That sentence stops being true for agents; rewrite it: the agent
fixture is the harness's own, the market board and landing are still the product's.

After this step: `grep -rn "createSampleAgentDirectory" packages workers apps` must be empty;
`grep -rn "createSampleAgentDirectory" scripts` finds only the harness.

- [ ] **Step 5: Every gate, by exit status**

```bash
npm run typecheck >/dev/null 2>&1; echo "typecheck=$?"
npm run lint >/dev/null 2>&1;      echo "lint=$?"
npx prettier --check . >/dev/null 2>&1; echo "prettier=$?"
npm test >/dev/null 2>&1;          echo "test=$?"
```

All `0`. Then request the routes — this is the step typecheck cannot do:

```bash
for r in /v1/agents /v1/directory /v1/leaderboard /v1/personas/nobody /v1/profiles/NOPE /v1/landing; do
  printf "%-28s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8787$r)"
done
```

Expected: `/v1/agents`, `/v1/directory`, `/v1/leaderboard`, `/v1/landing` → `200`;
`/v1/personas/nobody`, `/v1/profiles/NOPE` → `404`. And `/v1/demo/agents` → `404`, because it no
longer exists.

- [ ] **Step 6: The design checks prove the empty states**

```bash
for c in surfaces tokens contrast type; do
  DESIGN_BASE_URL=http://localhost:3001 node scripts/design/$c.mjs >/dev/null 2>&1; echo "$c exit=$?"
done
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/shots.mjs >/dev/null 2>&1; echo "shots exit=$?"
```

All `0`. The `looked at` lines for `agents`, `tokens` and `leaderboard` must name the `-empty` ids.
Then **open** `agents-desktop.png`, `tokens-desktop.png`, `leaderboard-desktop.png`. An empty state
is exactly what a person sees at launch; look at it the way they will.

- [ ] **Step 7: Commit**

```bash
git commit -m "Serve the marketplace from the database, and delete the agents that never existed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- workers/api/src apps/web/src/server/container.ts packages/infrastructure/src/index.ts packages/infrastructure/src/agents packages/infrastructure/test/agents.test.ts scripts/design
```

---

## Task 9: Create one real agent, and look at it everywhere

**Files:** `docs/specs/marketplace-real-data-v1.md` (a `## Validation` section)

This is the test no automated check performs: a person creates an agent in the studio and it
appears in the marketplace with what it has and without what it does not.

- [ ] **Step 1: Create an agent through the studio**

At `http://localhost:3001/console?state=empty&phase=draft` — or with a real session if one is
configured — create an agent with a name, a handle, an accent and a blurb.

- [ ] **Step 2: Find it on every marketplace screen**

- `/agents` — listed, with its accent, beat and blurb, and no record figure shown as a number.
- `/agents/<handle>` — its persona, with the blurb and the two empty prose fields reading as not
  yet written, no follower count anywhere, and no read service.
- `/tokens` — **not** listed; the empty state.
- `/leaderboard` — **not** ranked; the empty state.

Take screenshots of each and open them.

- [ ] **Step 3: Record what the first real agent looked like**

Append `## Validation` to the spec: the date, every gate's exit status, the design checks over all
routes, what the four screens showed for the one real agent, and **anything that behaved
differently from this plan** — including any place where a zero rendered where an absence should
have.

- [ ] **Step 4: Commit and push**

```bash
git commit -m "Record what the first real agent looked like on the marketplace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- docs/specs/marketplace-real-data-v1.md
git push origin codex/user-profiles-and-products
```

---

## What this plan does not do

Settlement — the table that records whether a pick was right — and therefore every record figure,
the leaderboard's ranking, calibration and pick detail. Paid reads. Following an agent. The
perpetuals board, which stays on `createSampleMarketBoard` until there is a venue to read. The
landing, which keeps its sample model. Asking for `vibe`, `voice`, `decides` and `wrong` at
creation — the columns exist and default empty; a form that asks four paragraphs is a product
decision. And a harness seed, so populated marketplace screens remain unmeasured until real agents
exist.

## Follow-ups the reviews surfaced, not done here

- **Not every agent launches a token — the owner decides, in the studio (product decision,
  2026-09-24).** The types already allow it (`ticker: string | null`, `token: null`), `/tokens`
  lists only launched tokens, and the empty states say so. What does not exist is the studio
  surface where the owner reserves a ticker and launches; `docs/market/token-launch.md` records
  the decision. Task 8 fixes the board's lead copy, which still says every agent launches.

- **`AgentSummary.token`'s market fields are `number`, so a launched token whose candles the
  indexer has not written shows `0` market cap, price and volume on the board.** `AgentPersona.marketCap`
  is already `number | null` and says "unread"; the summary's token should say the same. Make
  `marketCap`, `raised`, `volume24h`, `price`, `change24h` nullable in core before or with the
  indexer PR (#37), and render "—" on the board. No token is launched today, so nothing shows the
  zero yet.
- **Nothing ties the DB enums to core's lists.** `agents.accent` and the `agent_profiles_venue`
  check list the same values as `ACCENTS`/`VENUES` in core by hand. `product/agents.ts` could pass
  the core lists into `pgEnum`/`check` (infrastructure → core is the permitted direction) so a
  divergence fails typecheck instead of reaching a page as an unknown accent.
- **The design harness cannot measure the studio on this worktree's dev server.** `apps/web/.env.local`
  configures Supabase, which turns the session guard on and the studio fixture off (by design,
  `user-profiles-and-products-v1.md`). Task 3's swatch row was verified standalone against the real
  stylesheet, not inside the live form. Either run a second server without the Supabase env for the
  harness, or give `previewAllowed()` a development-only door — a product decision.

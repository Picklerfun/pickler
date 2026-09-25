# One agent, one id — and schema names that say what they hold

Pickler's database has eight schemas and 43 tables. The boundaries between them are mostly right.
Two things are wrong, and they are wrong in a way that costs a little every day rather than failing
loudly: **an agent has two identities with a translation table between them**, and **three schema
names do not describe their contents.**

This specification proposes fixing both. It is written to be decided, not to be started — three
pull requests are open against this branch and none of this belongs in them.

---

## 1. What is there now

| Schema     | Tables                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pickler`  | `agents` `runs` `events` `execution_policy` `provider_quotas` `paper_orders` `trading_accounts` `live_orders` `metadata` `provider_cache` `product_agents` `workspace_tenants` `budget_reservations` `budget_processed` `research_access` `budget_state` |
| `agents`   | `agents` `agent_profiles` `agent_configs` `agent_credentials` `agent_events`                                                                                                                                                                             |
| `identity` | `profiles` `handles` `handle_history` `wallet_links` `siwe_nonces` `workspaces` `workspace_members` `api_keys`                                                                                                                                           |
| `wallets`  | `turnkey_orgs` `wallets` `wallet_accounts` `passkeys` `webauthn_challenges`                                                                                                                                                                              |
| `market`   | `tokens` `pools` `fee_splits` `trades` `fee_payouts` `holders` `candles` `indexer_cursors`                                                                                                                                                               |
| `budget`   | `budgets` `ledger_entries`                                                                                                                                                                                                                               |
| `audit`    | `events` `idempotency_keys`                                                                                                                                                                                                                              |
| `growth`   | `waitlist` `applications`                                                                                                                                                                                                                                |

---

## 2. The real defect: two identities for one agent

`pickler.product_agents` is a translator:

```
product_agent_id  uuid  → agents.agents.id
runtime_agent_id  text  → pickler.agents.id
tenant_id         text
workspace_id      uuid  → identity.workspaces.id
```

`pickler.agents` is keyed by `(tenant_id text, id text)` and carries its configuration as `jsonb`.
`agents.agents` is keyed by `uuid`, scoped to a workspace, and normalised into profile, config,
credentials and events so each can be granted and audited on its own.

They are two generations of the same idea. The runtime came from the research pilot; the registry
came from the product. Neither is wrong on its own terms, and the split between **what an agent is**
and **what an agent did** is a sound boundary with genuinely different access patterns — which is
why this specification does not propose merging them.

**What is wrong is that "the agent id" is an ambiguous phrase in this repository.** Every query
that needs both sides pays for the join, every new reader has to learn which id they are holding,
and a translation table is a place where two systems can drift out of agreement with nothing to
notice.

### It is worse, and cheaper, than that: the two identities are already the same values

Traced through `packages/infrastructure/src/studio/directory.ts`, which is the only place either
is created:

```sql
-- line 46, the only INSERT into workspace_tenants in the repository
INSERT INTO pickler.workspace_tenants (workspace_id, tenant_id)
SELECT id, id::text FROM identity.workspaces WHERE owner_user_id=$1

-- line 121, the only INSERT into product_agents
INSERT INTO pickler.product_agents (product_agent_id, workspace_id, tenant_id, runtime_agent_id, …)
VALUES ($1::uuid, $2, $3, $1::text, …)
```

**`tenant_id` is `workspace_id` cast to text.** **`runtime_agent_id` is `product_agent_id` cast to
text** — the same `$1`, twice, in one statement. And `pickler.agents.id` is inserted at line 117
with the same `randomUUID()` that line 109 gave `agents.agents.id`.

`workspace_tenants` enforces it structurally too: `workspace_id` is the primary key and `tenant_id`
carries a unique index, so the relation is one-to-one in both directions by construction.

So `product_agents` is not a translator. **It maps every value to itself**, in a different type.
Every row is `(x::uuid, w, w::text, x::text, …)`.

This changes what the work is. There is **no data migration that has to decide which registry agent
a runtime agent is** — they are already the same uuid, one of them stored as text. The change is a
column type and a set of deletes, not a reconciliation.

### The fix: the registry's uuid is the id

`agents.agents.id` is the agent's identity. The runtime stops having one of its own.

- `pickler.agents` loses `id text` and `tenant_id`, and gains `agent_id uuid` with a foreign key.
- Every runtime table that carries `(tenant_id, agent_id)` carries `agent_id uuid` instead.
- `product_agents` is **deleted rather than migrated**. A translator with only one language left
  is not a table, it is a leftover.

`tenant_id` disappears as an agent-scoping key. Where multi-tenancy is still needed it is
`workspaces`, which already exists and which `agents.agents` already points at — so the tenant
concept is not lost, it stops being a second copy.

---

## 3. The names

Three of the eight describe something other than their contents.

**`pickler` means "everything", which means nothing.** It is the product's name, so it cannot
distinguish one part of the product from another. `pickler.agents` beside `agents.agents` has the
ambiguity baked into the name — a reader cannot tell them apart without opening both.

**`wallets` collides with a different kind of wallet.** It holds Turnkey sub-organizations,
passkeys and the accounts derived from them: keys Pickler holds under a quorum. But
`identity.wallet_links` holds wallets a person proved they control and that Pickler emphatically
does **not** hold. Two schemas, both about wallets, opposite custody. This was already the reason
`wallet_links` was put in `identity` rather than beside them — putting an external address in a
schema called `wallets` would suggest a custody that does not exist.

**`audit.events`, `pickler.events` and `agents.agent_events` are three logs with two names between
them.**

The replacement for `wallets` is **`signing`**, and it is not a new word — it is the one the
product already chose. The API mounts these at `/v1/signing`, with passkeys nested under it at
`/v1/signing/passkeys/*`, and `packages/core/src/features/signing/` exists.

**It must not be `custody`.** That was the first proposal in this document and it was wrong, for
the reason this same section gives two paragraphs above: a schema name that implies Pickler holds
something is a claim about custody, and here the claim would be false.
`turnkey-sub-organization.ts:65` is explicit — _"The root user gets the passkey and nothing else:
`apiKeys: []` is what keeps Pickler out"_ — with `rootQuorumThreshold: 1` and the person's passkey
as the only root user. The screen says **"YOUR KEY. NOT OURS."**

`custody` names a **relationship of holding**, which is the one thing this design exists to refuse.
`signing` names a **capability**, which stays true whoever holds the key.

### Proposed

| Now        | Proposed   | Holds                                                                   |
| ---------- | ---------- | ----------------------------------------------------------------------- |
| `pickler`  | `runtime`  | what an agent **did**: runs, decisions, orders, quotas, policy          |
| `agents`   | `agents`   | what an agent **is**: registry, profile, config, credentials            |
| `wallets`  | `signing`  | the apparatus a person signs with: Turnkey orgs, passkeys, accounts     |
| `identity` | `identity` | who someone is, including wallets they proved and Pickler does not hold |
| `market`   | `market`   | the curve: tokens, pools, trades, fees, candles                         |
| `budget`   | `budget`   | spend and its ledger — **absorbs the studio budget tables**             |
| `audit`    | `audit`    | the immutable record and idempotency keys                               |
| `growth`   | `growth`   | waitlist and applications                                               |

`runtime` rather than `execution` because the schema holds research runs as well as orders, and
`execution` reads as order execution alone. `runtime.events` becomes `runtime.run_events`, which
says whose events they are and stops colliding with `audit.events`.

### The studio tables go where their subject is

`pickler` currently holds six tables that belong to the studio rather than to the runtime. They do
not need a schema of their own; they need to be filed.

- `budget_reservations`, `budget_processed`, `budget_state` → `budget`, beside `budgets` and
  `ledger_entries`. Two budget homes is the same defect as two agent identities, one size smaller.
- `workspace_tenants` → `identity`, beside `workspaces`. It disappears entirely if §2 lands,
  because it exists to map a workspace to a runtime tenant.
- `research_access` → `identity`, beside `api_keys`. It is an entitlement, not a runtime concern.
- `product_agents` → deleted by §2.

---

## 4. What it costs, measured

Counted rather than estimated: **70 SQL references to `pickler.<table>` across ten files**, six of
them source and four tests.

| File                                                        | References |
| ----------------------------------------------------------- | ---------- |
| `packages/infrastructure/src/persistence/trading-store.ts`  | 27         |
| `packages/infrastructure/src/studio/directory.ts`           | 11         |
| `packages/infrastructure/src/persistence/paper-store.ts`    | 7          |
| `packages/infrastructure/src/studio/budget.ts`              | 7          |
| `packages/infrastructure/src/persistence/research-store.ts` | 4          |
| `packages/infrastructure/src/sports/cache.ts`               | 3          |
| `packages/infrastructure/src/studio/operator.ts`            | 1          |
| `workers/research/test/*`                                   | 7          |

The translation itself is narrower: `product_agents` and `runtimeAgentId` appear in **four source
files** — `console-schema.ts`, `research-store.ts`, `studio/directory.ts` and `studio/budget.ts`.

**Both are more mechanical than they first look.** Renaming a schema is a migration and a
find-and-replace over 70 call sites, each verifiable by the type checker and the suite.

The identity change looked like the expensive half and is not, because §2 established that the two
identities are already the same values in different types. `ALTER TABLE … ALTER COLUMN id TYPE uuid
USING id::uuid` is the whole of the data change; `tenant_id` is dropped rather than mapped, because
the column it would map to is the one it was cast from.

**Do them as two pieces, in this order.** The identity change first, because it deletes tables the
rename would otherwise have to carry; the rename second, when there is less to rename.

---

## 5. What would make this the wrong decision

Stated so that whoever decides has the counter-argument rather than only the case.

**If the runtime must work without knowing the product.** The strongest reason for two identities
is that `pickler.*` was built to run without `agents.*` existing at all — a research runtime that a
different product could sit on. If that is still wanted, `product_agents` is not a seam, it is the
interface, and this specification is wrong. Nothing in the code says either way, and the person who
built it knows.

**~~If `tenant_id` means something `workspace_id` does not.~~ Answered: it does not.** This was
listed as an open question and the code settles it. `workspace_tenants` is one-to-one in both
directions by index, and its only INSERT writes `id, id::text` from `identity.workspaces`. A tenant
is a workspace's uuid as a string. Nothing is lost by collapsing them because there is nothing
there to lose.

**If the runtime's `jsonb` config is deliberately opaque.** `agents.agent_configs` is versioned and
typed; `pickler.agents.config` is a blob. That may be so the runtime can evolve its configuration
without a migration, which is a real benefit this proposal does not preserve.

None of these is visible from the schema files. **Each should be answered before the work starts,
not discovered during it.**

---

## 6. Out of scope

The eight `rgba(5, 6, 26, α)` scrims, the `market` schema's indexer, and anything to do with the
three open pull requests. This changes where data lives and what it is called; it changes no
behaviour a person can see.

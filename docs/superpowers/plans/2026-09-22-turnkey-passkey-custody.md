# Turnkey Passkey Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a person a self-custodial Monad wallet whose only root user is their own passkey, reached through the sign-up, sign-in and new-device flows of `Pickler Auth Passkey Flow.dc.html`.

**Architecture:** Supabase Auth owns identity, Turnkey owns custody, and one row in a new `wallets` schema joins them. Decisions live in `packages/core` behind ports; the Turnkey parent key and Postgres live in `packages/infrastructure`; `workers/api` maps HTTP to use cases; `apps/web` runs the WebAuthn ceremony and talks to the API through the existing `/api/v1/*` proxy.

**Tech Stack:** TypeScript, Drizzle (PostgreSQL), Hono on Cloudflare Workers, Next.js 16 + React 19, `@turnkey/http` + `@turnkey/api-key-stamper` (stamping only; requests go through our own fetch), `@turnkey/webauthn-stamper`, viem, `node:test` with `tsx`.

**Spec:** `docs/specs/turnkey-passkey-custody-v1.md`. Read it before Task 1.

---

## Orientation for someone new to this repository

**Layering is enforced by taste, not by a linter.** `packages/core` must never import a database client, an SDK, Hono or React. It declares interfaces (called *ports*) and receives implementations. Follow `packages/core/src/features/profiles/` as the reference shape: `domain/` holds rules and errors, `ports/` holds interfaces, `application/` holds a `createXService(deps)` factory.

**Provenance is mandatory.** Every file ported from Relayer opens with `// Ported from Relayer <path> (commit bb6bb1226e92).` and states any deliberate change. Relayer lives at `/Users/Juvenal/Development/SherryLabs/relayer`.

**Tests use `node:test`, not Jest or Vitest.** `import { test } from "node:test"` and `import assert from "node:assert/strict"`.

**Commands you will use:**

| Purpose | Command |
| --- | --- |
| One core/infra test file | `node --import tsx --test packages/core/test/custody.test.ts` |
| One API test file | `npm run build:shared && node --import tsx --test workers/api/test/signing.test.ts` |
| Everything | `npm test` |
| Tests needing PostgreSQL | `npm run db:up` then `npm run test:supabase` |
| Generate a migration | `npm run db:generate` |
| Apply migrations | `npm run db:migrate` |
| Types | `npm run typecheck` |
| Format | `npm run format` |

**Make every fake record what it was handed, and assert on the recording.** This plan's own tests
got this wrong repeatedly, and the same mistake is available in every task that follows. A fake that
answers a constant lets a test assert that constant and prove only that the fake was called. Three
real examples caught by sabotage while executing this plan: a concurrency test passed with the whole
concurrency handling deleted; a test asserting `organizationId === "o"` passed when the caller's
root user was replaced with a stranger's, which in production means a phone stamping a credential
onto somebody else's wallet; and three separate guard clauses were free to delete with the suite
staying green.

So: give fakes an array they push their inputs onto, assert `deepEqual` against that array, and
assert the negative too — that the collaborator was *not* reached when a guard should have stopped
it, so the guard cannot drift below the call it protects.

**A sabotage that reports green is only evidence if the mutation landed.** A substitution that
silently matches nothing produces a green run indistinguishable from a real gap — a test passing
while nothing was covered, one level up from the defect you were hunting. This happened here: a
`perl` replacement failed to match because of apostrophes in a BIP32 derivation path, and the run
was nearly written up as a finding. Assert the target text is present before replacing it, and
print the changed line, every time. An unverified green sabotage is worth less than no sabotage,
because it is mistaken for proof.

**A concurrency test over a cold connection pool does not race.** `Promise.all` across a fresh `pg`
pool opens its connections one at a time, so the first query finishes before the second is
dispatched and the test proves nothing. This plan's `consume` race test passed while `consume` was
replaced by the sequential `SELECT`-then-`DELETE` it exists to rule out. Warm the connections first,
then fire; under the same sabotage it then fails every run. Treat any test that races through a pool
it has not warmed as untrustworthy.

**Pin a vendor's response keys, not only its request literals.** A wrong request literal fails the
build when typed against the SDK. A wrong response key read with `?.` becomes `undefined`, then a
plausible error message that blames the vendor — while the thing the vendor actually created sits
orphaned. That is how the V7/V8 defect in this plan would have presented: "Sub-organization was
created without an id", on every single registration, pointing at Turnkey.

**One barrel, one writer.** `packages/infrastructure/src/index.ts` is append-shaped, so two agents
adding exports do not conflict and nothing warns them. Staging "only your own paths by name" is
file-level granularity and does not protect it: one commit here swept in another agent's export line
while its module was still untracked, leaving the branch exporting from a file git did not have — a
break that surfaces in CI and nowhere local. Do not run two implementers concurrently when both may
touch it.

**Prove each test can fail before believing it.** Delete the line the test claims to cover and run
it. If the suite stays green, the test is decoration. This found every defect listed above, and none
of them were visible by reading.

**Two Turnkey facts that are easy to get wrong.** `@turnkey/http`'s `TurnkeyClient` cannot send requests on Workers — its fetch uses `redirect: "error"`. Use its `stamp*` methods to build and sign, then send with `sendStampedRequest` from `packages/infrastructure/src/turnkey/turnkey-transport.ts`. And the stamper must be pinned with `runtimeOverride: "browser"` so it uses WebCrypto instead of detecting Node.

**One security rule.** The sub-organization is created with `rootQuorumThreshold: 1`, the user's passkey as the only authenticator, and `apiKeys: []`. Never add a Pickler key to a sub-organization. This also means the parent key cannot install policies there afterwards, so no copy anywhere in this plan may claim a spending limit exists.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `packages/infrastructure/src/persistence/product/wallets.ts` | the `wallets` Drizzle schema |
| `packages/core/src/features/wallets/domain/passkey.ts` | attestation shape, transports, device type, errors |
| `packages/core/src/features/wallets/ports/custody.ts` | `ChallengeStore`, `CustodyRepository`, `SubOrganizationCreator`, `AddPasskeyActivityBuilder` |
| `packages/core/src/features/wallets/application/custody.ts` | `createCustodyService` — issue, register, prepare, confirm |
| `packages/infrastructure/src/turnkey/turnkey-sub-organization.ts` | `createSubOrganization` and the add-passkey activity builder |
| `packages/infrastructure/src/persistence/custody-store.ts` | `PostgresCustodyStore` — repository and challenge store |
| `packages/infrastructure/src/chain/balances.ts` | AUSD and MON balances for one address |
| `workers/api/src/routes/signing.ts` | `/v1/signing/passkeys` and `/v1/signing/wallets/me` |
| `apps/web/src/features/auth/lib/webauthn.ts` | base64url ↔ ArrayBuffer, transports |
| `apps/web/src/features/auth/lib/custody-api.ts` | typed client for the signing routes |
| `apps/web/src/features/auth/lib/flow.ts` | the step machine, framework-free and testable |
| `apps/web/src/features/auth/components/auth-flow.tsx` | shell that renders the current step |
| `apps/web/src/features/auth/components/steps/*.tsx` | one file per screen |
| `apps/web/src/features/auth/components/passkey-sheet.tsx` | the shared ceremony sheet |

**Modified**

| File | Change |
| --- | --- |
| `packages/infrastructure/drizzle.config.ts` | add `wallets` to `schemaFilter` |
| `packages/core/src/index.ts` | export the new feature |
| `packages/infrastructure/src/index.ts` | export the new adapters |
| `workers/api/src/env.ts` | five Turnkey bindings |
| `workers/api/src/app.ts` | mount the signing routes |
| `workers/api/src/container.ts` | compose the custody service |
| `workers/api/src/http/error-handler.ts` | map the new core errors |
| `apps/web/src/features/wallet/lib/signer.ts` | drop the `mera` signer kind |
| `apps/web/src/features/wallet/lib/wallet-context.tsx` | drop `meraSigner` from `SIGNERS` |
| `apps/web/src/features/wallet/components/connect-modal.tsx` | drop the `mera` entry |
| `apps/web/src/features/wallet/components/account-menu.tsx` | drop the `mera` label branch |
| `apps/web/src/app/(auth)/signup/page.tsx` | render `AuthFlow` |
| `apps/web/src/app/(auth)/signin/page.tsx` | render `AuthFlow` |

**Deleted**

| File | Why |
| --- | --- |
| `apps/web/src/features/wallet/lib/mera-signer.ts` | Turnkey replaces PRF custody (Task 11) |
| `apps/web/test/passkey-address.test.ts` | tests only the deleted signer |
| `apps/web/src/features/auth/components/sign-up-flow.tsx` | replaced by the step machine (Task 21) |
| `apps/web/src/features/auth/components/sign-in-card.tsx` | replaced by the step machine (Task 21) |
| `apps/web/src/features/auth/lib/password.ts` | passwords are gone (Task 21) |

---

## Task 1: The `wallets` schema

**Files:**
- Create: `packages/infrastructure/src/persistence/product/wallets.ts`
- Modify: `packages/infrastructure/drizzle.config.ts`

- [ ] **Step 1: Write the schema**

Follow `identity.ts` in the same directory for style: `pgSchema`, `.enableRLS()`, checks named explicitly.

```ts
// Ported from Relayer signing.{turnkey_orgs,wallets,wallet_accounts,passkeys}
// (commit bb6bb1226e92). Two deliberate changes, both required by
// docs/relayer-extraction/00-plan.md:
//   - the key is user_id, not integrator_id: a Pickler workspace is already unique per owner
//     and registration must not wait for one to exist;
//   - challenges live here rather than in Redis, because Workers has no Redis and KV cannot
//     promise a single consumer (blocker W2).

import { sql } from "drizzle-orm";
import { check, index, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const wallets = pgSchema("wallets");

/** One Turnkey sub-organization per person. Its only root user is their passkey. */
export const turnkeyOrgs = wallets
  .table(
    "turnkey_orgs",
    {
      userId: uuid("user_id").primaryKey(),
      subOrganizationId: text("sub_organization_id").notNull(),
      masterWalletId: text("master_wallet_id").notNull(),
      rootUserId: text("root_user_id").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("turnkey_orgs_sub_organization_key").on(t.subOrganizationId)],
  )
  .enableRLS();

export const walletRecords = wallets
  .table(
    "wallets",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      walletId: text("wallet_id").notNull(),
      subOrganizationId: text("sub_organization_id").notNull(),
      kind: text("kind").notNull(),
      name: text("name").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("wallets_wallet_key").on(t.walletId),
      index("wallets_user_idx").on(t.userId),
      check("wallets_kind", sql`${t.kind} in ('master', 'agent')`),
    ],
  )
  .enableRLS();

export const walletAccounts = wallets
  .table(
    "wallet_accounts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      walletId: text("wallet_id").notNull(),
      chain: text("chain").notNull(),
      address: text("address").notNull(),
      addressFormat: text("address_format").notNull(),
      path: text("path").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("wallet_accounts_wallet_path_key").on(t.walletId, t.path),
      check("wallet_accounts_chain", sql`${t.chain} in ('monad')`),
      check("wallet_accounts_address_format", sql`${t.address} ~ '^0x[0-9a-fA-F]{40}$'`),
    ],
  )
  .enableRLS();

/** Local mirror of the credentials Turnkey holds, for listing devices in the interface. */
export const passkeys = wallets
  .table(
    "passkeys",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      credentialId: text("credential_id").notNull(),
      label: text("label").notNull(),
      transports: text("transports").array().notNull().default(sql`array[]::text[]`),
      deviceType: text("device_type"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("passkeys_credential_key").on(t.credentialId),
      index("passkeys_user_idx").on(t.userId),
    ],
  )
  .enableRLS();

/** Single-use, five-minute TTL. Consumed with DELETE ... RETURNING. */
export const webauthnChallenges = wallets
  .table(
    "webauthn_challenges",
    {
      challenge: text("challenge").primaryKey(),
      userId: uuid("user_id").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (t) => [index("webauthn_challenges_expiry_idx").on(t.expiresAt)],
  )
  .enableRLS();
```

- [ ] **Step 2: Let Drizzle see the schema**

The file is picked up by the existing `./src/persistence/product/*.ts` glob, but `schemaFilter` is
an allowlist and does not mention `wallets`. Without this line `db:generate` silently produces
nothing. In `packages/infrastructure/drizzle.config.ts`:

```ts
  schemaFilter: ["pickler", "identity", "agents", "budget", "audit", "growth", "market", "wallets"],
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `packages/infrastructure/drizzle/`, named `00NN_<words>.sql`, containing `CREATE SCHEMA "wallets"` and five `CREATE TABLE` statements. Read it and confirm no existing table is altered or dropped.

- [ ] **Step 4: Apply it**

Run: `npm run db:up && npm run db:migrate`
Expected: the migration applies with no error. If the wrapper refuses unknown history, stop and report — never drop a schema to reconcile.

- [ ] **Step 5: Commit**

```bash
git add packages/infrastructure/src/persistence/product/wallets.ts packages/infrastructure/drizzle/ packages/infrastructure/drizzle.config.ts
git commit -m "Give custody somewhere to live"
```

---

## Task 2: Core domain — attestation, transports, device type

**Files:**
- Create: `packages/core/src/features/wallets/domain/passkey.ts`
- Test: `packages/core/test/custody-domain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceTypeFromTransports, toTurnkeyTransports } from "../src/features/wallets/domain/passkey.js";

test("an empty transport list means the authenticator is built into the device", () => {
  assert.deepEqual(toTurnkeyTransports([]), ["AUTHENTICATOR_TRANSPORT_INTERNAL"]);
  assert.deepEqual(toTurnkeyTransports(undefined), ["AUTHENTICATOR_TRANSPORT_INTERNAL"]);
});

test("transports are upper-cased into Turnkey's enum", () => {
  assert.deepEqual(toTurnkeyTransports(["usb", "nfc"]), [
    "AUTHENTICATOR_TRANSPORT_USB",
    "AUTHENTICATOR_TRANSPORT_NFC",
  ]);
});

test("hybrid transport names a passkey that lives on another device", () => {
  assert.equal(deviceTypeFromTransports(["hybrid"]), "cross_device");
  assert.equal(deviceTypeFromTransports(["internal"]), "platform");
  assert.equal(deviceTypeFromTransports(["usb"]), "security_key");
  assert.equal(deviceTypeFromTransports([]), "platform");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test packages/core/test/custody-domain.test.ts`
Expected: FAIL, `Cannot find module '.../domain/passkey.js'`.

- [ ] **Step 3: Write the domain**

```ts
// Ported from Relayer apps/web/lib/webauthn/buffer-utils.ts#toTurnkeyTransports and
// apps/api/src/kits/signing/passkeys/device-type.util.ts (commit bb6bb1226e92).
// Changed: device type is derived from transports rather than from an AAGUID vendor table.
// Relayer's table needs upkeep per vendor and is only used to label a row in the interface.

/** What `navigator.credentials.create()` gives us, base64url-encoded. */
export interface PasskeyAttestation {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export type DeviceType = "platform" | "cross_device" | "security_key";

export interface ChallengeOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  authenticatorSelection: { residentKey: "preferred"; userVerification: "preferred" };
  timeout: number;
  attestation: "none";
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
}

export function toTurnkeyTransports(transports: string[] | undefined): string[] {
  if (!transports?.length) {
    return ["AUTHENTICATOR_TRANSPORT_INTERNAL"];
  }
  return transports.map((t) => `AUTHENTICATOR_TRANSPORT_${t.toUpperCase()}`);
}

export function deviceTypeFromTransports(transports: string[]): DeviceType {
  if (transports.includes("hybrid")) {
    return "cross_device";
  }
  if (transports.some((t) => t === "usb" || t === "nfc" || t === "ble")) {
    return "security_key";
  }
  return "platform";
}

/** The challenge was never issued, was already used, or has expired (HTTP 400). */
export class ChallengeNotUsableError extends Error {
  constructor() {
    super("This passkey request expired. Start again.");
    this.name = "ChallengeNotUsableError";
  }
}

/** This person has no sub-organization yet, so there is nothing to add a device to (HTTP 409). */
export class NoCustodyAccountError extends Error {
  constructor() {
    super("No wallet exists for this account yet");
    this.name = "NoCustodyAccountError";
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test packages/core/test/custody-domain.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/features/wallets/domain/passkey.ts packages/core/test/custody-domain.test.ts
git commit -m "Name what a passkey tells us about where it lives"
```

---

## Task 3: Core ports and `issueChallenge`

**Files:**
- Create: `packages/core/src/features/wallets/ports/custody.ts`
- Create: `packages/core/src/features/wallets/application/custody.ts`
- Test: `packages/core/test/custody.test.ts`

- [ ] **Step 1: Write the ports**

No test: this file is types only.

```ts
import type { PasskeyAttestation } from "../domain/passkey.js";

export interface CustodyAccount {
  userId: string;
  subOrganizationId: string;
  masterWalletId: string;
  rootUserId: string;
  address: string;
}

export interface StoredChallenge {
  userId: string;
  expiresAt: Date;
}

export interface ChallengeStore {
  put(challenge: string, record: StoredChallenge): Promise<void>;
  /** Returns the record and deletes it in one statement, or null if it was not there. */
  consume(challenge: string): Promise<StoredChallenge | null>;
}

export interface RegistrationInput {
  userId: string;
  subOrganizationId: string;
  masterWalletId: string;
  rootUserId: string;
  walletId: string;
  address: string;
  credentialId: string;
  label: string;
  transports: string[];
  deviceType: string;
}

export interface CustodyRepository {
  findByUserId(userId: string): Promise<CustodyAccount | null>;
  listCredentials(userId: string): Promise<{ credentialId: string; transports: string[] }[]>;
  /**
   * One transaction across turnkey_orgs, wallets, wallet_accounts and passkeys.
   * Returns `created: false` when the unique index on user_id already holds a row,
   * which is how a concurrent double submit is told apart from a failure.
   */
  saveRegistration(input: RegistrationInput): Promise<{ created: boolean }>;
  addPasskey(input: {
    userId: string;
    credentialId: string;
    label: string;
    transports: string[];
    deviceType: string;
  }): Promise<void>;
}

export interface SubOrganizationCreator {
  create(input: {
    ownerEmail: string;
    discriminator: string;
    label: string;
    challenge: string;
    attestation: PasskeyAttestation;
  }): Promise<{
    subOrganizationId: string;
    walletId: string;
    address: string;
    rootUserId: string;
  }>;
}

export interface UnsignedActivity {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

export interface AddPasskeyActivityBuilder {
  build(input: {
    subOrganizationId: string;
    rootUserId: string;
    label: string;
    challenge: string;
    attestation: PasskeyAttestation;
  }): UnsignedActivity;
}
```

- [ ] **Step 2: Write the failing test for `issueChallenge`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import type {
  ChallengeStore,
  CustodyRepository,
  StoredChallenge,
  SubOrganizationCreator,
} from "../src/features/wallets/ports/custody.js";

const NOW = new Date("2026-09-22T12:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

export function fakes() {
  const stored = new Map<string, StoredChallenge>();
  const challenges: ChallengeStore = {
    async put(challenge, record) {
      stored.set(challenge, record);
    },
    async consume(challenge) {
      const found = stored.get(challenge) ?? null;
      stored.delete(challenge);
      return found;
    },
  };
  const rows: { account: unknown } = { account: null };
  const credentials: { credentialId: string; transports: string[] }[] = [];
  const repository: CustodyRepository = {
    async findByUserId() {
      return rows.account as never;
    },
    async listCredentials() {
      return credentials;
    },
    async saveRegistration(input) {
      if (rows.account) {
        return { created: false };
      }
      rows.account = {
        userId: input.userId,
        subOrganizationId: input.subOrganizationId,
        masterWalletId: input.masterWalletId,
        rootUserId: input.rootUserId,
        address: input.address,
      };
      return { created: true };
    },
    async addPasskey(input) {
      credentials.push({ credentialId: input.credentialId, transports: input.transports });
    },
  };
  let created = 0;
  const turnkey: SubOrganizationCreator = {
    async create() {
      created += 1;
      return {
        subOrganizationId: `sub-${created}`,
        walletId: `wal-${created}`,
        address: "0x1111111111111111111111111111111111111111",
        rootUserId: `usr-${created}`,
      };
    },
  };
  return { challenges, repository, turnkey, stored, credentials, calls: () => created, rows };
}

export function service(f: ReturnType<typeof fakes>) {
  let seed = 0;
  return createCustodyService({
    challenges: f.challenges,
    repository: f.repository,
    turnkey: f.turnkey,
    activities: { build: () => ({ url: "u", body: "b", timestampMs: "1", organizationId: "o" }) },
    forwarder: { forward: async () => ({ id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED" }) },
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => NOW,
    randomId: () => `r${(seed += 1)}`,
  });
}

test("a challenge is stored against the caller and offered with the right algorithms", async () => {
  const f = fakes();
  const options = await service(f).issueChallenge(USER, "ana@pickler.fun");

  assert.equal(options.challenge, "r1");
  assert.equal(options.rp.id, "pickler.fun");
  assert.equal(options.rp.name, "Pickler");
  assert.equal(options.user.name, "ana@pickler.fun");
  assert.deepEqual(
    options.pubKeyCredParams.map((p) => p.alg),
    [-7, -257],
  );
  assert.deepEqual(f.stored.get("r1"), {
    userId: USER,
    expiresAt: new Date(NOW.getTime() + 300_000),
  });
});

test("existing credentials are excluded so the browser refuses a second enrolment", async () => {
  const f = fakes();
  f.credentials.push({ credentialId: "cred-1", transports: ["internal"] });

  const options = await service(f).issueChallenge(USER, "ana@pickler.fun");

  assert.deepEqual(options.excludeCredentials, [
    { id: "cred-1", type: "public-key", transports: ["internal"] },
  ]);
});

test("a failed credential lookup never blocks the challenge", async () => {
  const f = fakes();
  f.repository.listCredentials = async () => {
    throw new Error("database down");
  };

  const options = await service(f).issueChallenge(USER, "ana@pickler.fun");

  assert.equal(options.challenge, "r1");
  assert.equal(options.excludeCredentials, undefined);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --import tsx --test packages/core/test/custody.test.ts`
Expected: FAIL, `Cannot find module '.../application/custody.js'`.

- [ ] **Step 4: Write `createCustodyService` with `issueChallenge` only**

```ts
// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts (commit bb6bb1226e92).
// Changed: the challenge store is a port over Postgres rather than Redis, and the caller is a
// Supabase user rather than an integrator.

import {
  ChallengeNotUsableError,
  NoCustodyAccountError,
  deviceTypeFromTransports,
  type ChallengeOptions,
  type PasskeyAttestation,
} from "../domain/passkey.js";
import type {
  AddPasskeyActivityBuilder,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  SubOrganizationCreator,
  UnsignedActivity,
} from "../ports/custody.js";
import type { SignedActivityForwarder } from "../../signing/ports/signing.js";
import type { SignedActivityRequest } from "../../signing/domain/turnkey-activity.js";

const CHALLENGE_TTL_MS = 300_000;

export interface CustodyServiceDeps {
  challenges: ChallengeStore;
  repository: CustodyRepository;
  turnkey: SubOrganizationCreator;
  activities: AddPasskeyActivityBuilder;
  forwarder: SignedActivityForwarder;
  rpId: string;
  appName: string;
  now: () => Date;
  randomId: () => string;
}

export function createCustodyService(deps: CustodyServiceDeps) {
  /**
   * Best-effort. A lookup failure must never stop a person registering, so it degrades to
   * no exclusions rather than propagating. Relayer learned this the same way.
   */
  async function excludeCredentials(userId: string) {
    try {
      const existing = await deps.repository.listCredentials(userId);
      if (!existing.length) {
        return undefined;
      }
      return existing.map((c) => ({
        id: c.credentialId,
        type: "public-key" as const,
        ...(c.transports.length ? { transports: c.transports } : {}),
      }));
    } catch {
      return undefined;
    }
  }

  return {
    async issueChallenge(userId: string, email: string): Promise<ChallengeOptions> {
      const challenge = deps.randomId();
      await deps.challenges.put(challenge, {
        userId,
        expiresAt: new Date(deps.now().getTime() + CHALLENGE_TTL_MS),
      });
      const exclude = await excludeCredentials(userId);
      return {
        challenge,
        rp: { id: deps.rpId, name: deps.appName },
        user: { id: deps.randomId(), name: email, displayName: email },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        timeout: CHALLENGE_TTL_MS,
        attestation: "none",
        ...(exclude ? { excludeCredentials: exclude } : {}),
      };
    },
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node --import tsx --test packages/core/test/custody.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/features/wallets/ packages/core/test/custody.test.ts
git commit -m "Issue a challenge the browser cannot spend twice"
```

---

## Task 4: Core — register, idempotent and race-safe

**Files:**
- Modify: `packages/core/src/features/wallets/application/custody.ts`
- Test: `packages/core/test/custody.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/custody.test.ts`:

```ts
const attestation = {
  credentialId: "cred-1",
  clientDataJson: "Y2xpZW50",
  attestationObject: "YXR0",
  transports: ["internal"],
};

test("registering creates the sub-organization and returns the account", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");

  const account = await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID on This Mac",
    challenge: options.challenge,
    attestation,
  });

  assert.equal(account.subOrganizationId, "sub-1");
  assert.equal(account.address, "0x1111111111111111111111111111111111111111");
  assert.equal(f.calls(), 1);
});

test("a replay returns the existing account and never mints a second sub-organization", async () => {
  const f = fakes();
  const s = service(f);
  const first = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: first.challenge,
    attestation,
  });

  const second = await s.issueChallenge(USER, "ana@pickler.fun");
  const account = await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: second.challenge,
    attestation,
  });

  assert.equal(account.subOrganizationId, "sub-1");
  assert.equal(f.calls(), 1, "Turnkey must not be called again");
});

test("a challenge cannot be spent twice", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: options.challenge,
    attestation,
  });
  f.rows.account = null; // force past the idempotency pre-check

  await assert.rejects(
    () =>
      s.register(USER, {
        email: "ana@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    ChallengeNotUsableError,
  );
});

test("a challenge that outlived its TTL is refused", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  // The service clock is fixed, so age the stored record instead: this is what the row looks
  // like once the five-minute TTL has run out under a real clock. Without this test the expiry
  // clause can be deleted and the whole suite stays green — it is the only gate on the TTL,
  // because the Postgres consume in Task 7 returns an expired row as readily as a live one.
  f.stored.set(options.challenge, { userId: USER, expiresAt: new Date(NOW.getTime() - 1) });

  await assert.rejects(
    () =>
      s.register(USER, {
        email: "ana@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    ChallengeNotUsableError,
  );
  assert.equal(f.calls(), 0, "an expired challenge must never reach Turnkey");
});

test("a challenge belonging to someone else is refused", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");

  await assert.rejects(
    () =>
      s.register("22222222-2222-4222-8222-222222222222", {
        email: "otra@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    ChallengeNotUsableError,
  );
  // Load-bearing. `put` already exists, so a compensating rollback — restoring the challenge
  // because "a stranger should not burn someone else's" — needs no port change, looks obviously
  // right to whoever writes it, and passes every other test. It would leave a challenge that
  // survives probing and a window where the same one is claimed twice. This assertion is what
  // stops it; a comment would not.
  assert.equal(
    f.stored.has(options.challenge),
    false,
    "a rejected claim still spends the challenge; putting it back would let a stranger probe it",
  );
});

test("the loser of a concurrent submit gets the winner's account, not a 500", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  // The pre-check passes, then the unique index rejects the insert: saveRegistration reports
  // created:false and findByUserId now answers with the winner's row. The lookup MUST answer
  // null the first time. If it returns the winner unconditionally, the pre-check returns early,
  // the backstop is never reached, and this test passes with the whole backstop deleted.
  f.repository.saveRegistration = async () => ({ created: false });
  let lookups = 0;
  f.repository.findByUserId = async () => {
    lookups += 1;
    return lookups === 1
      ? null
      : {
          userId: USER,
          subOrganizationId: "sub-winner",
          masterWalletId: "wal-winner",
          rootUserId: "usr-winner",
          address: "0x2222222222222222222222222222222222222222",
        };
  };

  const account = await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: options.challenge,
    attestation,
  });

  assert.equal(account.subOrganizationId, "sub-winner");
  assert.equal(f.calls(), 1, "the pre-check must have been passed, not short-circuited");
  assert.equal(lookups, 2, "the winner must be re-read after the conflict");
});

test("a conflict with no readable winner fails loudly rather than returning nothing", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  f.repository.saveRegistration = async () => ({ created: false });
  f.repository.findByUserId = async () => null;

  await assert.rejects(
    () =>
      s.register(USER, {
        email: "ana@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    /orphan sub-org/i,
  );
});
```

The first `findByUserId` fake must read from `rows.account`. Replace the fake's `findByUserId` body in `fakes()` with:

```ts
    async findByUserId() {
      return (rows.account as CustodyAccount | null) ?? null;
    },
```

and add `import type { CustodyAccount } from "../src/features/wallets/ports/custody.js";` to the test imports,
plus a value import of the error class the tests assert on:

```ts
import { ChallengeNotUsableError } from "../src/features/wallets/domain/passkey.js";
```

Assert the class, never the message. The class is the contract the HTTP layer maps to a 400; the
message is product copy that someone will reword while tightening onboarding, and when they do, a
message assertion fails and points at custody rather than at the copy.

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test packages/core/test/custody.test.ts`
Expected: FAIL, `s.register is not a function`.

- [ ] **Step 3: Add `register`**

Inside the object returned by `createCustodyService`, after `issueChallenge`:

```ts
    /**
     * Idempotent by design. Relayer's version minted a second sub-organization on every retry
     * from a stale tab, which broke the single-row lookup and returned the person to the passkey
     * screen for ever. The pre-check handles the ordinary retry; `created: false` handles the
     * concurrent submit that races past it.
     */
    async register(
      userId: string,
      input: {
        email: string;
        label: string;
        challenge: string;
        attestation: PasskeyAttestation;
      },
    ): Promise<CustodyAccount> {
      const existing = await deps.repository.findByUserId(userId);
      if (existing) {
        return existing;
      }

      const claimed = await deps.challenges.consume(input.challenge);
      if (!claimed || claimed.userId !== userId || claimed.expiresAt <= deps.now()) {
        throw new ChallengeNotUsableError();
      }

      const created = await deps.turnkey.create({
        ownerEmail: input.email,
        discriminator: userId.slice(0, 8),
        label: input.label,
        challenge: input.challenge,
        attestation: input.attestation,
      });

      const saved = await deps.repository.saveRegistration({
        userId,
        subOrganizationId: created.subOrganizationId,
        masterWalletId: created.walletId,
        rootUserId: created.rootUserId,
        walletId: created.walletId,
        address: created.address,
        credentialId: input.attestation.credentialId,
        label: input.label,
        transports: input.attestation.transports,
        deviceType: deviceTypeFromTransports(input.attestation.transports),
      });

      if (saved.created) {
        return {
          userId,
          subOrganizationId: created.subOrganizationId,
          masterWalletId: created.walletId,
          rootUserId: created.rootUserId,
          address: created.address,
        };
      }

      // Lost the race. The winner's sub-organization is the real one; ours is an orphan in
      // Turnkey and is logged by the caller for out-of-band reconciliation.
      const winner = await deps.repository.findByUserId(userId);
      if (!winner) {
        throw new Error(
          `Registration conflicted but no account is readable for ${userId}; orphan sub-org ${created.subOrganizationId}`,
        );
      }
      return winner;
    },
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test packages/core/test/custody.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/features/wallets/application/custody.ts packages/core/test/custody.test.ts
git commit -m "Make registering twice cost nothing"
```

---

## Task 5: Core — prepare and confirm a new device

**Files:**
- Modify: `packages/core/src/features/wallets/application/custody.ts`
- Test: `packages/core/test/custody.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
test("preparing a new device needs an existing account", async () => {
  const f = fakes();
  await assert.rejects(
    () =>
      service(f).prepareAddPasskey(USER, {
        label: "Phone",
        challenge: "nope",
        attestation,
      }),
    /no wallet exists/i,
  );
});

test("preparing returns the unsigned activity for the phone to stamp", async () => {
  const f = fakes();
  const s = service(f);
  const first = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: first.challenge,
    attestation,
  });
  const next = await s.issueChallenge(USER, "ana@pickler.fun");

  const prepared = await s.prepareAddPasskey(USER, {
    label: "Phone",
    challenge: next.challenge,
    attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
  });

  assert.equal(prepared.organizationId, "o");
  assert.equal(prepared.body, "b");
});

test("confirming forwards the stamped activity and mirrors the credential", async () => {
  const f = fakes();
  const s = service(f);
  const first = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: first.challenge,
    attestation,
  });

  const result = await s.confirmAddPasskey(USER, {
    label: "Phone",
    credentialId: "cred-2",
    transports: ["hybrid"],
    signed: {
      url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
      body: "b",
      stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
    },
  });

  assert.equal(result.status, "ACTIVITY_STATUS_COMPLETED");
  assert.ok(f.credentials.some((c) => c.credentialId === "cred-2"));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test packages/core/test/custody.test.ts`
Expected: FAIL, `s.prepareAddPasskey is not a function`.

- [ ] **Step 3: Add both methods**

```ts
    /**
     * The new device creates its own credential first; this builds the CREATE_AUTHENTICATORS
     * activity that adds it, which an existing passkey then stamps. Relayer numbers the same
     * two steps "create" and "verify" in its add-passkey modal.
     */
    async prepareAddPasskey(
      userId: string,
      input: { label: string; challenge: string; attestation: PasskeyAttestation },
    ): Promise<UnsignedActivity> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const claimed = await deps.challenges.consume(input.challenge);
      if (!claimed || claimed.userId !== userId || claimed.expiresAt <= deps.now()) {
        throw new ChallengeNotUsableError();
      }
      return deps.activities.build({
        subOrganizationId: account.subOrganizationId,
        rootUserId: account.rootUserId,
        label: input.label,
        challenge: input.challenge,
        attestation: input.attestation,
      });
    },

    async confirmAddPasskey(
      userId: string,
      input: {
        label: string;
        credentialId: string;
        transports: string[];
        signed: SignedActivityRequest;
      },
    ) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const activity = await deps.forwarder.forward(input.signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_AUTHENTICATORS"],
      });
      if (activity.status === "ACTIVITY_STATUS_COMPLETED") {
        await deps.repository.addPasskey({
          userId,
          credentialId: input.credentialId,
          label: input.label,
          transports: input.transports,
          deviceType: deviceTypeFromTransports(input.transports),
        });
      }
      return activity;
    },

    getAccount: (userId: string) => deps.repository.findByUserId(userId),
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test packages/core/test/custody.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Export the feature**

Append to `packages/core/src/index.ts`:

```ts
export {
  ChallengeNotUsableError,
  NoCustodyAccountError,
  deviceTypeFromTransports,
  toTurnkeyTransports,
  type ChallengeOptions,
  type DeviceType,
  type PasskeyAttestation,
} from "./features/wallets/domain/passkey.js";
export type {
  AddPasskeyActivityBuilder,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  RegistrationInput,
  StoredChallenge,
  SubOrganizationCreator,
  UnsignedActivity,
} from "./features/wallets/ports/custody.js";
export {
  createCustodyService,
  type CustodyServiceDeps,
} from "./features/wallets/application/custody.js";
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add packages/core/
git commit -m "Let a phone vouch for a device it has never met"
```

---

## Task 6: Turnkey adapter — create the sub-organization

**Files:**
- Create: `packages/infrastructure/src/turnkey/turnkey-sub-organization.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `packages/infrastructure/test/turnkey-sub-organization.test.ts`

- [ ] **Step 1: Write the failing test**

The test injects a fake `fetch`, so no network and no credentials are needed. `createTurnkeyStampingClient` signs with a throwaway P-256 key.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSubOrganizationCreator } from "../src/turnkey/turnkey-sub-organization.js";

// A throwaway P-256 pair, generated for this test only, so the stamper has something to sign
// with. It grants nothing: no Turnkey organisation has ever seen it.
const API_PRIVATE_KEY = "8ed65e1a5df0575403b95a980aff3876e184880fefea3c93ca6cd7285f878efe";
const API_PUBLIC_KEY = "036cf295a1e7c92d196e7e3def64b7532b23205b4651621fcd2ed7332487807c74";

test("it asks Turnkey for a sub-organization whose only root user is the passkey", async () => {
  let sent: { url: string; body: unknown } | null = null;
  const creator = createSubOrganizationCreator({
    apiPublicKey: API_PUBLIC_KEY,
    apiPrivateKey: API_PRIVATE_KEY,
    parentOrganizationId: "parent-org",
    fetch: (async (url: string, init: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({
          activity: {
            id: "act-1",
            status: "ACTIVITY_STATUS_COMPLETED",
            result: {
              createSubOrganizationResultV7: {
                subOrganizationId: "sub-1",
                rootUserIds: ["usr-1"],
                wallet: { walletId: "wal-1", addresses: ["0xabc"] },
              },
            },
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
  });

  const result = await creator.create({
    ownerEmail: "ana@pickler.fun",
    discriminator: "11111111",
    label: "Touch ID on This Mac",
    challenge: "chal",
    attestation: {
      credentialId: "cred-1",
      clientDataJson: "Y2xpZW50",
      attestationObject: "YXR0",
      transports: ["internal"],
    },
  });

  assert.deepEqual(result, {
    subOrganizationId: "sub-1",
    walletId: "wal-1",
    address: "0xabc",
    rootUserId: "usr-1",
  });

  const body = sent!.body as {
    rootQuorumThreshold: number;
    rootUsers: { apiKeys: unknown[]; authenticators: { attestation: { transports: string[] } }[] }[];
    wallet: { accounts: { path: string; addressFormat: string }[] };
  };
  assert.equal(body.rootQuorumThreshold, 1);
  assert.equal(body.rootUsers.length, 1);
  assert.deepEqual(body.rootUsers[0].apiKeys, [], "Pickler must hold no key inside a sub-org");
  assert.deepEqual(body.rootUsers[0].authenticators[0].attestation.transports, [
    "AUTHENTICATOR_TRANSPORT_INTERNAL",
  ]);
  assert.deepEqual(body.wallet.accounts, [
    {
      curve: "CURVE_SECP256K1",
      pathFormat: "PATH_FORMAT_BIP32",
      path: "m/44'/60'/0'/0/0",
      addressFormat: "ADDRESS_FORMAT_ETHEREUM",
    },
  ]);
});

test("a missing wallet in the response is an error, not a half-made account", async () => {
  const creator = createSubOrganizationCreator({
    apiPublicKey: API_PUBLIC_KEY,
    apiPrivateKey: API_PRIVATE_KEY,
    parentOrganizationId: "parent-org",
    fetch: (async () =>
      new Response(
        JSON.stringify({
          activity: {
            result: { createSubOrganizationResultV7: { subOrganizationId: "sub-1" } },
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch,
  });

  await assert.rejects(
    () =>
      creator.create({
        ownerEmail: "ana@pickler.fun",
        discriminator: "11111111",
        label: "Touch ID",
        challenge: "chal",
        attestation: {
          credentialId: "c",
          clientDataJson: "c",
          attestationObject: "a",
          transports: [],
        },
      }),
    /wallet/i,
  );
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test packages/infrastructure/test/turnkey-sub-organization.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the adapter**

```ts
// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts#register
// (commit bb6bb1226e92). Changed: one Monad (EVM) account instead of Ethereum plus Solana,
// because report 02 puts Solana out of scope; and the request is sent with our own fetch,
// because @turnkey/http cannot send on Workers.

import {
  SigningServiceUnavailableError,
  toTurnkeyTransports,
  type PasskeyAttestation,
  type SubOrganizationCreator,
  type UnsignedActivity,
} from "@pickler/core";
import { createTurnkeyStampingClient, sendStampedRequest, TURNKEY_API_BASE_URL } from "./turnkey-transport.js";

/** The single account every Master Wallet gets. Monad is EVM, so the Ethereum format applies. */
export const MONAD_ACCOUNT = {
  curve: "CURVE_SECP256K1",
  pathFormat: "PATH_FORMAT_BIP32",
  path: "m/44'/60'/0'/0/0",
  addressFormat: "ADDRESS_FORMAT_ETHEREUM",
} as const;

export interface SubOrganizationCreatorConfig {
  apiPublicKey: string;
  apiPrivateKey: string;
  parentOrganizationId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface CreateSubOrgResponse {
  activity?: {
    result?: {
      createSubOrganizationResultV7?: {
        subOrganizationId?: string;
        rootUserIds?: string[];
        wallet?: { walletId?: string; addresses?: string[] };
      };
    };
  };
}

export function createSubOrganizationCreator(
  config: SubOrganizationCreatorConfig,
): SubOrganizationCreator {
  const client = createTurnkeyStampingClient(config);
  return {
    async create(input) {
      // Email plus an id fragment, so the Turnkey dashboard is scannable by a human. Both are
      // immutable, unlike a workspace name.
      const signed = await client.stampCreateSubOrganization({
        organizationId: config.parentOrganizationId,
        subOrganizationName: `${input.ownerEmail} · ${input.discriminator}`,
        rootQuorumThreshold: 1,
        rootUsers: [
          {
            userName: input.ownerEmail,
            apiKeys: [],
            oauthProviders: [],
            authenticators: [
              {
                authenticatorName: input.label || "Default Passkey",
                challenge: input.challenge,
                attestation: {
                  credentialId: input.attestation.credentialId,
                  clientDataJson: input.attestation.clientDataJson,
                  attestationObject: input.attestation.attestationObject,
                  transports: toTurnkeyTransports(input.attestation.transports),
                },
              },
            ],
          },
        ],
        wallet: { walletName: "Master Wallet", accounts: [MONAD_ACCOUNT] },
      });

      const response = await sendStampedRequest<CreateSubOrgResponse>(signed, config);
      const result = response.activity?.result?.createSubOrganizationResultV7;
      const subOrganizationId = result?.subOrganizationId;
      const walletId = result?.wallet?.walletId;
      const address = result?.wallet?.addresses?.[0];
      const rootUserId = result?.rootUserIds?.[0];

      if (!subOrganizationId) {
        throw new SigningServiceUnavailableError("Sub-organization was created without an id");
      }
      if (!walletId || !address) {
        throw new SigningServiceUnavailableError("Master wallet was not returned");
      }
      if (!rootUserId) {
        throw new SigningServiceUnavailableError("Root user was not returned");
      }
      return { subOrganizationId, walletId, address, rootUserId };
    },
  };
}

/**
 * Builds the unsigned CREATE_AUTHENTICATORS body the browser stamps with an existing passkey.
 * Not stamped here: the parent key is not a voter inside a sub-organization.
 */
export function createAddPasskeyActivityBuilder(config: { baseUrl?: string } = {}) {
  const baseUrl = config.baseUrl ?? TURNKEY_API_BASE_URL;
  return {
    build(input: {
      subOrganizationId: string;
      rootUserId: string;
      label: string;
      challenge: string;
      attestation: PasskeyAttestation;
    }): UnsignedActivity {
      const timestampMs = String(Date.now());
      const body = JSON.stringify({
        type: "ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2",
        timestampMs,
        organizationId: input.subOrganizationId,
        parameters: {
          userId: input.rootUserId,
          authenticators: [
            {
              authenticatorName: input.label,
              challenge: input.challenge,
              attestation: {
                credentialId: input.attestation.credentialId,
                clientDataJson: input.attestation.clientDataJson,
                attestationObject: input.attestation.attestationObject,
                transports: toTurnkeyTransports(input.attestation.transports),
              },
            },
          ],
        },
      });
      return {
        url: `${baseUrl}/public/v1/submit/create_authenticators`,
        body,
        timestampMs,
        organizationId: input.subOrganizationId,
      };
    },
  };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test packages/infrastructure/test/turnkey-sub-organization.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Export and commit**

Append to `packages/infrastructure/src/index.ts`:

```ts
export {
  createAddPasskeyActivityBuilder,
  createSubOrganizationCreator,
  MONAD_ACCOUNT,
  type SubOrganizationCreatorConfig,
} from "./turnkey/turnkey-sub-organization.js";
```

```bash
git add packages/infrastructure/src/turnkey/ packages/infrastructure/src/index.ts packages/infrastructure/test/turnkey-sub-organization.test.ts
git commit -m "Create an organisation we cannot enter"
```

---

## Task 7: Postgres custody store

**Files:**
- Create: `packages/infrastructure/src/persistence/custody-store.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `packages/infrastructure/test/custody-store.test.ts`

- [ ] **Step 1: Write the failing test**

Uses the real database through `createTestStore`, which makes an isolated database per test.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./database.js";
import { PostgresCustodyStore } from "../src/persistence/custody-store.js";

const USER = "11111111-1111-4111-8111-111111111111";

const registration = {
  userId: USER,
  subOrganizationId: "sub-1",
  masterWalletId: "wal-1",
  rootUserId: "usr-1",
  walletId: "wal-1",
  address: "0x1111111111111111111111111111111111111111",
  credentialId: "cred-1",
  label: "Touch ID",
  transports: ["internal"],
  deviceType: "platform",
};

test("a registration is written whole, and a second one is refused", async (t) => {
  const store = await createTestStore(t);
  const custody = new PostgresCustodyStore(store.pool);

  assert.deepEqual(await custody.saveRegistration(registration), { created: true });

  const account = await custody.findByUserId(USER);
  assert.equal(account?.subOrganizationId, "sub-1");
  assert.equal(account?.address, registration.address);
  assert.deepEqual(await custody.listCredentials(USER), [
    { credentialId: "cred-1", transports: ["internal"] },
  ]);

  assert.deepEqual(
    await custody.saveRegistration({ ...registration, subOrganizationId: "sub-2", walletId: "wal-2", credentialId: "cred-9" }),
    { created: false },
    "the unique index on user_id is the backstop for a concurrent submit",
  );
  assert.equal((await custody.findByUserId(USER))?.subOrganizationId, "sub-1");
});

test("a failed registration leaves nothing behind", async (t) => {
  const store = await createTestStore(t);
  const custody = new PostgresCustodyStore(store.pool);

  await assert.rejects(() =>
    custody.saveRegistration({ ...registration, address: "not-an-address" }),
  );

  assert.equal(await custody.findByUserId(USER), null);
  assert.deepEqual(await custody.listCredentials(USER), []);
});

test("a challenge can only be consumed once", async (t) => {
  const store = await createTestStore(t);
  const custody = new PostgresCustodyStore(store.pool);
  const expiresAt = new Date(Date.now() + 60_000);

  await custody.put("chal-1", { userId: USER, expiresAt });

  const first = await custody.consume("chal-1");
  assert.equal(first?.userId, USER);
  assert.equal(await custody.consume("chal-1"), null);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run db:up && TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler node --import tsx --test packages/infrastructure/test/custody-store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the store**

```ts
// Ported from Relayer signing repositories (commit bb6bb1226e92). Two changes:
// the four inserts run in one transaction rather than in sequence — Relayer's version logs
// "orphan in Turnkey" on every intermediate failure — and challenges are consumed with
// DELETE ... RETURNING instead of a Redis get-then-delete.

import type { Pool } from "pg";
import type {
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  RegistrationInput,
  StoredChallenge,
} from "@pickler/core";

export class PostgresCustodyStore implements CustodyRepository, ChallengeStore {
  constructor(private readonly pool: Pool) {}

  async findByUserId(userId: string): Promise<CustodyAccount | null> {
    const { rows } = await this.pool.query<CustodyAccount>(
      `SELECT o.user_id AS "userId",
              o.sub_organization_id AS "subOrganizationId",
              o.master_wallet_id AS "masterWalletId",
              o.root_user_id AS "rootUserId",
              a.address AS "address"
         FROM wallets.turnkey_orgs o
         JOIN wallets.wallet_accounts a ON a.wallet_id = o.master_wallet_id
        WHERE o.user_id = $1
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async listCredentials(userId: string) {
    const { rows } = await this.pool.query<{ credentialId: string; transports: string[] }>(
      `SELECT credential_id AS "credentialId", transports
         FROM wallets.passkeys
        WHERE user_id = $1
        ORDER BY created_at`,
      [userId],
    );
    return rows;
  }

  async saveRegistration(input: RegistrationInput): Promise<{ created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const org = await client.query(
        `INSERT INTO wallets.turnkey_orgs
           (user_id, sub_organization_id, master_wallet_id, root_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id`,
        [input.userId, input.subOrganizationId, input.masterWalletId, input.rootUserId],
      );
      if (org.rowCount === 0) {
        await client.query("ROLLBACK");
        return { created: false };
      }
      await client.query(
        `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
         VALUES ($1, $2, $3, 'master', 'Master Wallet')`,
        [input.userId, input.walletId, input.subOrganizationId],
      );
      await client.query(
        `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
         VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', $3)`,
        [input.walletId, input.address, "m/44'/60'/0'/0/0"],
      );
      await client.query(
        `INSERT INTO wallets.passkeys (user_id, credential_id, label, transports, device_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.credentialId, input.label, input.transports, input.deviceType],
      );
      await client.query("COMMIT");
      return { created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async addPasskey(input: {
    userId: string;
    credentialId: string;
    label: string;
    transports: string[];
    deviceType: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO wallets.passkeys (user_id, credential_id, label, transports, device_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (credential_id) DO NOTHING`,
      [input.userId, input.credentialId, input.label, input.transports, input.deviceType],
    );
  }

  async put(challenge: string, record: StoredChallenge): Promise<void> {
    await this.pool.query(
      `INSERT INTO wallets.webauthn_challenges (challenge, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [challenge, record.userId, record.expiresAt],
    );
  }

  /** One statement, so two concurrent readers cannot both receive the same challenge. */
  async consume(challenge: string): Promise<StoredChallenge | null> {
    const { rows } = await this.pool.query<{ userId: string; expiresAt: Date }>(
      `DELETE FROM wallets.webauthn_challenges
        WHERE challenge = $1
        RETURNING user_id AS "userId", expires_at AS "expiresAt"`,
      [challenge],
    );
    return rows[0] ?? null;
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler node --import tsx --test packages/infrastructure/test/custody-store.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Export and commit**

Append to `packages/infrastructure/src/index.ts`:

```ts
export { PostgresCustodyStore } from "./persistence/custody-store.js";
```

```bash
git add packages/infrastructure/src/persistence/custody-store.ts packages/infrastructure/src/index.ts packages/infrastructure/test/custody-store.test.ts
git commit -m "Write four rows or none"
```

---

## Task 8: Balances for the welcome screen

**Files:**
- Create: `packages/infrastructure/src/chain/balances.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `packages/infrastructure/test/balances.test.ts`

This resolves the first open decision in the spec: the API returns balances so `apps/web` needs no new dependency.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBalanceReader } from "../src/chain/balances.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function rpc(handlers: Record<string, string>) {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { method: string; id: number };
    const key = body.method === "eth_getBalance" ? "native" : "erc20";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handlers[key] }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

test("it reads the native and AUSD balances at their own decimals", async () => {
  const reader = createBalanceReader({
    chainId: 10143,
    fetch: rpc({
      native: "0x6f05b59d3b20000", // 0.5 MON, 18 decimals
      erc20: "0x0000000000000000000000000000000000000000000000000000000004c4b400", // 80 AUSD, 6 decimals
    }),
  });

  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.symbol, "MON");
  assert.equal(balances.native.decimals, 18);
  assert.equal(balances.native.raw, "500000000000000000");
  assert.equal(balances.token.symbol, "AUSD");
  assert.equal(balances.token.decimals, 6);
  assert.equal(balances.token.raw, "80000000");
});

test("an unreachable chain yields nulls rather than an invented number", async () => {
  const reader = createBalanceReader({
    chainId: 10143,
    fetch: (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
  });

  const balances = await reader.read(ADDRESS);

  assert.equal(balances.native.raw, null);
  assert.equal(balances.token.raw, null);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test packages/infrastructure/test/balances.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the reader**

`@pickler/chain` exports `AUSD` as a record keyed by chain id, and `requireSupportedChain`, which
throws rather than falling back to another network — Relayer defaulted to Base or Sepolia and that
is a defect this repository already fixed. Use both; do not write addresses as literals.

Two plain JSON-RPC calls rather than a viem client, so the injected `fetch` in the test is the same
code path production uses.

```ts
// Balances for one address on Monad. Values that cannot be read come back null: the interface
// says "unavailable" rather than showing a zero that looks like an empty wallet.

import { AUSD, networkByChainId, requireSupportedChain } from "@pickler/chain";

export interface Balance {
  symbol: string;
  decimals: number;
  /** Base units as a decimal string, or null when the chain could not be read. */
  raw: string | null;
}

export interface Balances {
  native: Balance;
  token: Balance;
}

export interface BalanceReaderConfig {
  chainId: number;
  rpcUrl?: string;
  fetch?: typeof fetch;
}

/** `balanceOf(address)`. The argument is the address, left-padded to 32 bytes. */
const BALANCE_OF = "0x70a08231";

export function createBalanceReader(config: BalanceReaderConfig) {
  const chainId = requireSupportedChain(config.chainId);
  const network = networkByChainId(chainId)!;
  const token = AUSD[chainId];
  const url = config.rpcUrl ?? network.publicRpcUrls[0];
  const doFetch = config.fetch ?? fetch;

  async function rpc(method: string, params: unknown[]): Promise<string> {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(5_000),
    });
    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (!payload.result) {
      throw new Error(payload.error?.message ?? `${method} returned no result`);
    }
    return payload.result;
  }

  return {
    async read(address: string): Promise<Balances> {
      const native: Balance = {
        symbol: network.nativeCurrency.symbol,
        decimals: network.nativeCurrency.decimals,
        raw: null,
      };
      const held: Balance = { symbol: token.symbol, decimals: token.decimals, raw: null };
      try {
        const [nativeHex, tokenHex] = await Promise.all([
          rpc("eth_getBalance", [address, "latest"]),
          rpc("eth_call", [
            { to: token.address, data: `${BALANCE_OF}${address.slice(2).padStart(64, "0")}` },
            "latest",
          ]),
        ]);
        native.raw = BigInt(nativeHex).toString();
        held.raw = BigInt(tokenHex).toString();
      } catch {
        // Both stay null. A wallet whose balance we could not read is not a wallet with nothing
        // in it, and the screen must not say otherwise.
      }
      return { native, token: held };
    },
  };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test packages/infrastructure/test/balances.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Export and commit**

```ts
export { createBalanceReader, type Balance, type Balances } from "./chain/balances.js";
```

```bash
git add packages/infrastructure/src/chain/ packages/infrastructure/src/index.ts packages/infrastructure/test/balances.test.ts
git commit -m "Say the balance or say nothing"
```

---

## Task 9: The signing routes

**Files:**
- Create: `workers/api/src/routes/signing.ts`
- Modify: `workers/api/src/app.ts`, `workers/api/src/env.ts`, `workers/api/src/container.ts`, `workers/api/src/http/error-handler.ts`
- Test: `workers/api/test/signing.test.ts`

- [ ] **Step 1: Map the new core errors**

In `workers/api/src/http/error-handler.ts`, add to the imports from `@pickler/core`:

```ts
  ChallengeNotUsableError,
  NoCustodyAccountError,
```

and inside `classify`, before the `DataSourceUnavailableError` branch:

```ts
  if (error instanceof ChallengeNotUsableError) {
    return { status: 400, message: error.message, extras: { error: "challenge_expired" } };
  }
  if (error instanceof NoCustodyAccountError) {
    return { status: 409, message: error.message, extras: { error: "no_custody_account" } };
  }
```

- [ ] **Step 2: Add the bindings**

In `workers/api/src/env.ts`, inside `interface Env`:

```ts
  /** Turnkey parent organisation credentials. Never placed inside a sub-organisation. */
  TURNKEY_API_PUBLIC_KEY?: string;
  TURNKEY_API_PRIVATE_KEY?: string;
  TURNKEY_PARENT_ORG_ID?: string;
  /** WebAuthn relying party: "localhost" in development, the site domain in production. */
  TURNKEY_RPID?: string;
  /** Shown in the operating system's passkey prompt. */
  TURNKEY_APP_NAME?: string;
```

- [ ] **Step 3: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserPrincipal, type Workspace } from "@pickler/core";
import { createApp } from "../src/app.js";

const USER = "11111111-1111-4111-8111-111111111111";
const workspace: Workspace = {
  id: "w1",
  name: "Ana Labs",
  userId: USER,
  isActive: true,
  activeModules: ["agent"],
};

function app(overrides: Record<string, unknown> = {}) {
  const account = {
    userId: USER,
    subOrganizationId: "sub-1",
    masterWalletId: "wal-1",
    rootUserId: "usr-1",
    address: "0x1111111111111111111111111111111111111111",
  };
  const custody = {
    issueChallenge: async () => ({ challenge: "chal", rp: { id: "pickler.fun", name: "Pickler" } }),
    register: async () => account,
    prepareAddPasskey: async () => ({ url: "u", body: "b", timestampMs: "1", organizationId: "sub-1" }),
    confirmAddPasskey: async () => ({ id: "act", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED" }),
    getAccount: async () => account,
    ...overrides,
  };
  // Services this suite does not exercise are stubbed with `{} as never`, the pattern
  // workers/api/test/agents.test.ts already uses.
  return createApp({
    authenticate: async () => ({
      principal: buildUserPrincipal({ id: USER, email: "ana@pickler.fun" }) as never,
      workspace,
    }),
    authenticateAgent: {} as never,
    findWorkspace: async () => workspace,
    budgets: {} as never,
    profiles: {} as never,
    agentQueries: {} as never,
    custody: {
      service: custody as never,
      balances: {
        read: async () => ({
          native: { symbol: "MON", decimals: 18, raw: "1" },
          token: { symbol: "AUSD", decimals: 6, raw: "2" },
        }),
      },
    },
  });
}

const auth = { Authorization: "Bearer token" };

test("a challenge is issued to a signed-in caller", async () => {
  const response = await app().request("/v1/signing/passkeys/challenge", {
    method: "POST",
    headers: auth,
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { challenge: string } };
  assert.equal(body.data.challenge, "chal");
});

test("registering answers with the address, never with anything about the parent key", async () => {
  const response = await app().request("/v1/signing/passkeys/register", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "Touch ID",
      challenge: "chal",
      attestation: {
        credentialId: "c",
        clientDataJson: "c",
        attestationObject: "a",
        transports: ["internal"],
      },
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { data: Record<string, unknown> };
  assert.equal(body.data.address, "0x1111111111111111111111111111111111111111");
  assert.equal(body.data.sub_organization_id, "sub-1");
  assert.equal(body.data.root_user_id, undefined, "the root user id is not the browser's business");
});

test("a malformed attestation is refused before Turnkey is called", async () => {
  let called = false;
  const response = await app({
    register: async () => {
      called = true;
      throw new Error("must not reach Turnkey");
    },
  }).request("/v1/signing/passkeys/register", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Touch ID", challenge: "chal", attestation: { credentialId: 5 } }),
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("the wallet endpoint carries the balances", async () => {
  const response = await app().request("/v1/signing/wallets/me", { headers: auth });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { address: string; balances: { token: { symbol: string } } };
  };
  assert.equal(body.data.balances.token.symbol, "AUSD");
});

test("with no account yet, the wallet endpoint says so rather than inventing one", async () => {
  const response = await app({ getAccount: async () => null }).request("/v1/signing/wallets/me", {
    headers: auth,
  });
  assert.equal(response.status, 404);
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `npm run build:shared && node --import tsx --test workers/api/test/signing.test.ts`
Expected: FAIL, 404 for every route.

- [ ] **Step 5: Write the routes**

```ts
import type { Balances, createBalanceReader } from "@pickler/infrastructure";
import type { createCustodyService } from "@pickler/core";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { successEnvelope } from "../http/envelope";
import { badRequest, notFound } from "../http/http-error";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface CustodyServices {
  service: ReturnType<typeof createCustodyService>;
  balances: ReturnType<typeof createBalanceReader>;
}

export interface SigningRouteServices {
  authenticate: Authenticate;
  custody: CustodyServices;
}

interface AttestationBody {
  credentialId?: unknown;
  clientDataJson?: unknown;
  attestationObject?: unknown;
  transports?: unknown;
}

/** Everything here is base64url from the browser; a wrong shape must never reach Turnkey. */
function readAttestation(value: unknown) {
  const a = (value ?? {}) as AttestationBody;
  if (
    typeof a.credentialId !== "string" ||
    typeof a.clientDataJson !== "string" ||
    typeof a.attestationObject !== "string" ||
    !Array.isArray(a.transports) ||
    a.transports.some((t) => typeof t !== "string")
  ) {
    throw badRequest("Field 'attestation' is malformed");
  }
  return {
    credentialId: a.credentialId,
    clientDataJson: a.clientDataJson,
    attestationObject: a.attestationObject,
    transports: a.transports as string[],
  };
}

function readString(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (typeof value !== "string" || !value) {
    throw badRequest(`Field '${field}' must be a non-empty string`);
  }
  return value;
}

async function readBody(c: { req: { json(): Promise<unknown> } }) {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    throw badRequest("A JSON body is required");
  }
  return body;
}

const accountDto = (account: { subOrganizationId: string; masterWalletId: string; address: string }) => ({
  sub_organization_id: account.subOrganizationId,
  master_wallet_id: account.masterWalletId,
  address: account.address,
});

export function signingRoutes(services: SigningRouteServices) {
  const signedIn = authenticated(services.authenticate, { userOnly: true });
  const { service, balances } = services.custody;

  return new Hono<AppEnv>()
    .post("/passkeys/challenge", signedIn, async (c) => {
      const principal = c.get("principal");
      const options = await service.issueChallenge(principal.id, principal.email ?? "");
      return c.json(successEnvelope(options, c.req.path, "Challenge issued"), 200, {
        "Cache-Control": "no-store",
      });
    })
    .post("/passkeys/register", signedIn, async (c) => {
      const body = await readBody(c);
      const principal = c.get("principal");
      const account = await service.register(principal.id, {
        email: principal.email ?? "",
        label: readString(body, "label"),
        challenge: readString(body, "challenge"),
        attestation: readAttestation(body.attestation),
      });
      return c.json(successEnvelope(accountDto(account), c.req.path, "Passkey registered"), 201);
    })
    .post("/passkeys/add/prepare", signedIn, async (c) => {
      const body = await readBody(c);
      const activity = await service.prepareAddPasskey(c.get("principal").id, {
        label: readString(body, "label"),
        challenge: readString(body, "challenge"),
        attestation: readAttestation(body.attestation),
      });
      return c.json(successEnvelope(activity, c.req.path, "Activity prepared"));
    })
    .post("/passkeys/add/confirm", signedIn, async (c) => {
      const body = await readBody(c);
      const signed = body.signed as { url?: unknown; body?: unknown; stamp?: unknown } | undefined;
      const stamp = (signed?.stamp ?? {}) as { stampHeaderName?: unknown; stampHeaderValue?: unknown };
      if (
        typeof signed?.url !== "string" ||
        typeof signed.body !== "string" ||
        typeof stamp.stampHeaderName !== "string" ||
        typeof stamp.stampHeaderValue !== "string"
      ) {
        throw badRequest("Field 'signed' is malformed");
      }
      const transports = Array.isArray(body.transports) ? (body.transports as string[]) : [];
      const activity = await service.confirmAddPasskey(c.get("principal").id, {
        label: readString(body, "label"),
        credentialId: readString(body, "credential_id"),
        transports,
        signed: {
          url: signed.url,
          body: signed.body,
          stamp: {
            stampHeaderName: stamp.stampHeaderName,
            stampHeaderValue: stamp.stampHeaderValue,
          },
        },
      });
      return c.json(successEnvelope({ status: activity.status }, c.req.path, "Device added"));
    })
    .get("/wallets/me", signedIn, async (c) => {
      const account = await service.getAccount(c.get("principal").id);
      if (!account) {
        throw notFound("Wallet");
      }
      const read: Balances = await balances.read(account.address);
      return c.json(
        successEnvelope({ ...accountDto(account), balances: read }, c.req.path, "Wallet retrieved"),
        200,
        { "Cache-Control": "no-store" },
      );
    });
}
```

- [ ] **Step 6: Mount the routes**

In `workers/api/src/app.ts`, add the import and the service field, then the mount after `/v1/profile`:

```ts
import { signingRoutes, type SigningRouteServices } from "./routes/signing";
```

```ts
export interface Services extends AgentRouteServices, ProfileRouteServices {
  authenticate: Authenticate;
  /** Absent until the Turnkey bindings exist; the routes are not mounted without them. */
  custody?: SigningRouteServices["custody"];
  console?: ConsoleServices;
  growth?: ReturnType<typeof createGrowthServices>;
}
```

```ts
  if (services.custody) {
    app.route("/v1/signing", signingRoutes({ authenticate: services.authenticate, custody: services.custody }));
  }
```

- [ ] **Step 7: Run and watch it pass**

Run: `npm run build:shared && node --import tsx --test workers/api/test/signing.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Compose the service**

In `workers/api/src/container.ts`, add to the imports from `@pickler/infrastructure`:

```ts
  createAddPasskeyActivityBuilder,
  createBalanceReader,
  createSubOrganizationCreator,
  createSignedActivityForwarder,
  PostgresCustodyStore,
```

If `createSignedActivityForwarder` is not exported yet, read
`packages/infrastructure/src/turnkey/turnkey-activity-forwarder.ts` for the factory's real name and
use that.

Then, inside `createServices`, before the returned object:

```ts
  // Mounted only when every Turnkey binding is present, so a deployment without them keeps
  // serving the rest of the API instead of failing to compose.
  const turnkeyConfigured =
    env.TURNKEY_API_PUBLIC_KEY &&
    env.TURNKEY_API_PRIVATE_KEY &&
    env.TURNKEY_PARENT_ORG_ID &&
    env.TURNKEY_RPID;
  const custodyStore = new PostgresCustodyStore(repository.pool);
  const custody = turnkeyConfigured
    ? {
        service: createCustodyService({
          challenges: custodyStore,
          repository: custodyStore,
          turnkey: createSubOrganizationCreator({
            apiPublicKey: env.TURNKEY_API_PUBLIC_KEY!,
            apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY!,
            parentOrganizationId: env.TURNKEY_PARENT_ORG_ID!,
          }),
          activities: createAddPasskeyActivityBuilder(),
          forwarder: createSignedActivityForwarder({
            apiPublicKey: env.TURNKEY_API_PUBLIC_KEY!,
            apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY!,
          }),
          rpId: env.TURNKEY_RPID!,
          appName: env.TURNKEY_APP_NAME ?? "Pickler",
          now,
          randomId: () => crypto.randomUUID().replaceAll("-", ""),
        }),
        balances: createBalanceReader({ chainId: 10143 }),
      }
    : undefined;
```

and add `...(custody ? { custody } : {}),` to the returned object. Import `createCustodyService` from `@pickler/core`.

- [ ] **Step 9: Typecheck, run everything, commit**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

```bash
git add workers/api/ packages/
git commit -m "Open the four doors a passkey needs"
```

---

## Task 10: Document the new bindings

**Files:**
- Modify: `workers/api/AGENTS.md`
- Modify: `workers/api/.dev.vars.example` (create if absent)

- [ ] **Step 1: Write the example file**

`workers/api/.dev.vars.example`:

```
# Turnkey parent organisation. These credentials are never placed inside a sub-organisation:
# a sub-organisation's only root user is the person's passkey.
TURNKEY_API_PUBLIC_KEY=
TURNKEY_API_PRIVATE_KEY=
TURNKEY_PARENT_ORG_ID=
# WebAuthn relying party. "localhost" locally; the site domain in production. A mismatch here is
# the most common cause of SecurityError in the browser.
TURNKEY_RPID=localhost
TURNKEY_APP_NAME=Pickler (Local)
```

- [ ] **Step 2: Add a paragraph to `workers/api/AGENTS.md`**

Under the existing configuration notes:

```markdown
## Turnkey custody

`/v1/signing/*` is mounted only when `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`,
`TURNKEY_PARENT_ORG_ID` and `TURNKEY_RPID` are all bound; without them the rest of the API still
serves. The parent key reads and creates sub-organizations. It is never a root user inside one,
so it cannot sign for a person and cannot install policies in their sub-organization. Sub-organizations
therefore run with root-quorum default-allow until the passkey-signed policy round exists; nothing
in the product may present that as a spending limit.
```

- [ ] **Step 3: Commit**

```bash
git add workers/api/AGENTS.md workers/api/.dev.vars.example
git commit -m "Say which secrets custody needs and what they cannot do"
```

---

## Task 11: Retire the PRF signer

Turnkey now owns custody. The Mera PRF path derived a private key from the passkey's PRF output, and it asked for *any* passkey on `pickler.fun` — including, once this ships, the Turnkey one. Two wallets and one of them able to consume the other's credential is not a state to leave running.

**Files:**
- Delete: `apps/web/src/features/wallet/lib/mera-signer.ts`, `apps/web/test/passkey-address.test.ts`
- Modify: `apps/web/src/features/wallet/lib/signer.ts`, `apps/web/src/features/wallet/lib/wallet-context.tsx`, `apps/web/src/features/wallet/components/connect-modal.tsx`, `apps/web/src/features/wallet/components/account-menu.tsx`, `apps/web/package.json`

- [ ] **Step 1: Narrow the signer kind**

In `apps/web/src/features/wallet/lib/signer.ts`, replace line 14 and adjust the doc comment above it, which currently describes "two unlike things":

```ts
/**
 * What the site needs from whatever holds the person's keys.
 *
 * One thing sits behind this shape today: a wallet the person brought, injected by the browser,
 * which can be pointed at the wrong chain and changes under the page when they switch account.
 * The person's own Pickler wallet is not here — it is custodied in Turnkey, reached through the
 * signing API, and never derived in the page.
 */

export type SignerKind = "injected";
```

- [ ] **Step 2: Drop it from the adapters**

In `apps/web/src/features/wallet/lib/wallet-context.tsx`: remove the `import { meraSigner } from "./mera-signer";` line, change line 40 to `const SIGNERS: SignerAdapter[] = [injectedSigner];`, and change the parser on line 60 to `return value === "injected" ? value : null;`.

- [ ] **Step 3: Drop the copy**

In `apps/web/src/features/wallet/components/connect-modal.tsx`, delete the `mera` entry from `COPY`.
In `apps/web/src/features/wallet/components/account-menu.tsx` line 95, replace the conditional with the single label:

```tsx
              BROWSER WALLET
```

- [ ] **Step 4: Delete the files and the dependency**

```bash
git rm apps/web/src/features/wallet/lib/mera-signer.ts apps/web/test/passkey-address.test.ts
```

Remove `"@category-labs/mera": "^0.2.0"` from `apps/web/package.json` dependencies, then run `npm install`.

- [ ] **Step 5: Verify nothing still refers to it**

Run: `grep -rn "mera\|Mera" apps/web/src apps/web/test`
Expected: no output.

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web packages
git commit -m "Stop deriving a second wallet from the same finger"
```

---

## Task 12: WebAuthn helpers in the browser

**Files:**
- Create: `apps/web/src/features/auth/lib/webauthn.ts`
- Test: `apps/web/test/webauthn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64urlToBuffer,
  bufferToBase64url,
  normalizeTransports,
} from "../src/features/auth/lib/webauthn";

test("base64url survives a round trip without padding or unsafe characters", () => {
  const bytes = new Uint8Array([251, 255, 190, 0, 1, 2, 3]);
  const encoded = bufferToBase64url(bytes.buffer);

  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(new Uint8Array(base64urlToBuffer(encoded)), bytes);
});

test("decoding restores padding the encoder removed", () => {
  assert.deepEqual(new Uint8Array(base64urlToBuffer("QQ")), new Uint8Array([65]));
  assert.deepEqual(new Uint8Array(base64urlToBuffer("QUJD")), new Uint8Array([65, 66, 67]));
});

test("transports come back lower-case, and an empty list means internal", () => {
  assert.deepEqual(normalizeTransports(["USB", "hybrid"]), ["usb", "hybrid"]);
  assert.deepEqual(normalizeTransports(undefined), ["internal"]);
  assert.deepEqual(normalizeTransports([]), ["internal"]);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test apps/web/test/webauthn.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the helpers**

```ts
// Ported from Relayer apps/web/lib/webauthn/buffer-utils.ts (commit bb6bb1226e92).
// The browser speaks ArrayBuffer and the API speaks base64url; these are the only two places
// that conversion happens.

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** `getTransports()` is optional and absent on some authenticators; internal is the safe default. */
export function normalizeTransports(transports: string[] | undefined): string[] {
  if (!transports?.length) {
    return ["internal"];
  }
  return transports.map((t) => t.toLowerCase());
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test apps/web/test/webauthn.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/lib/webauthn.ts apps/web/test/webauthn.test.ts
git commit -m "Translate between the browser's bytes and the wire"
```

---

## Task 13: The ceremony, as one testable function

**Files:**
- Create: `apps/web/src/features/auth/lib/custody-api.ts`
- Create: `apps/web/src/features/auth/lib/ceremony.ts`
- Test: `apps/web/test/ceremony.test.ts`

Keeping the ceremony out of the component is what makes it testable at all: a React component cannot be driven from `node:test`, but a function taking `credentials` and a client can.

- [ ] **Step 1: Write the API client**

No test: it is a thin wrapper over `call` in `pickler-api.ts`. Read that file first and reuse its `call`, `ApiError` and envelope handling rather than writing a second fetch layer.

```ts
"use client";

import { call } from "./pickler-api";

export interface ChallengeOptionsDto {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: string; alg: number }[];
  authenticatorSelection?: { residentKey?: string; userVerification?: string };
  timeout?: number;
  attestation?: string;
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
}

export interface AttestationDto {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export interface WalletDto {
  sub_organization_id: string;
  master_wallet_id: string;
  address: string;
  balances?: {
    native: { symbol: string; decimals: number; raw: string | null };
    token: { symbol: string; decimals: number; raw: string | null };
  };
}

export interface UnsignedActivityDto {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

export interface CustodyClient {
  challenge(token: string): Promise<ChallengeOptionsDto>;
  register(
    token: string,
    input: { label: string; challenge: string; attestation: AttestationDto },
  ): Promise<WalletDto>;
  prepareAdd(
    token: string,
    input: { label: string; challenge: string; attestation: AttestationDto },
  ): Promise<UnsignedActivityDto>;
  confirmAdd(
    token: string,
    input: {
      label: string;
      credential_id: string;
      transports: string[];
      signed: { url: string; body: string; stamp: { stampHeaderName: string; stampHeaderValue: string } };
    },
  ): Promise<{ status: string }>;
  wallet(token: string): Promise<WalletDto>;
}

export const custodyClient: CustodyClient = {
  challenge: (token) => call("/v1/signing/passkeys/challenge", { method: "POST", token }),
  register: (token, body) =>
    call("/v1/signing/passkeys/register", { method: "POST", token, body: JSON.stringify(body) }),
  prepareAdd: (token, body) =>
    call("/v1/signing/passkeys/add/prepare", { method: "POST", token, body: JSON.stringify(body) }),
  confirmAdd: (token, body) =>
    call("/v1/signing/passkeys/add/confirm", { method: "POST", token, body: JSON.stringify(body) }),
  wallet: (token) => call("/v1/signing/wallets/me", { token }),
};
```

If `call` is not exported from `pickler-api.ts`, export it there in this step.

- [ ] **Step 2: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPasskey, describeCeremonyFailure } from "../src/features/auth/lib/ceremony";

const options = {
  challenge: "Y2hhbA",
  rp: { id: "localhost", name: "Pickler" },
  user: { id: "dXNlcg", name: "ana@pickler.fun", displayName: "ana@pickler.fun" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [{ id: "Y3JlZA", type: "public-key" as const, transports: ["internal"] }],
};

function credentialsThatReturn(id: string) {
  const calls: { publicKey: PublicKeyCredentialCreationOptions }[] = [];
  const credentials = {
    async create(request: { publicKey: PublicKeyCredentialCreationOptions }) {
      calls.push(request);
      return {
        id,
        response: {
          clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
          attestationObject: new Uint8Array([4, 5, 6]).buffer,
          getTransports: () => ["hybrid"],
        },
      };
    },
  };
  return { credentials: credentials as unknown as CredentialsContainer, calls };
}

test("it decodes the server's options and encodes what comes back", async () => {
  const { credentials, calls } = credentialsThatReturn("cred-new");

  const attestation = await createPasskey(credentials, options, "platform");

  assert.equal(attestation.credentialId, "cred-new");
  assert.equal(attestation.clientDataJson, "AQID");
  assert.equal(attestation.attestationObject, "BAUG");
  assert.deepEqual(attestation.transports, ["hybrid"]);

  const sent = calls[0].publicKey;
  assert.deepEqual(new Uint8Array(sent.challenge as ArrayBuffer), new Uint8Array([99, 104, 97, 108]));
  assert.equal(sent.authenticatorSelection?.authenticatorAttachment, "platform");
  assert.equal(sent.excludeCredentials?.length, 1, "already-enrolled credentials are excluded");
});

test("asking for a phone selects the cross-device attachment, which is what draws the QR", async () => {
  const { credentials, calls } = credentialsThatReturn("cred-phone");

  await createPasskey(credentials, options, "cross-platform");

  assert.equal(calls[0].publicKey.authenticatorSelection?.authenticatorAttachment, "cross-platform");
});

test("a browser that returns nothing is an error, not a silent success", async () => {
  const credentials = { async create() { return null; } } as unknown as CredentialsContainer;

  await assert.rejects(() => createPasskey(credentials, options, "platform"), /did not return/i);
});

test("each failure gets copy a person can act on", () => {
  const named = (name: string) => Object.assign(new Error("x"), { name });
  assert.equal(describeCeremonyFailure(named("NotAllowedError")), null);
  assert.match(String(describeCeremonyFailure(named("InvalidStateError"))), /already has a passkey/i);
  assert.match(String(describeCeremonyFailure(named("SecurityError"))), /this address/i);
  assert.match(String(describeCeremonyFailure(named("NotSupportedError"))), /does not support/i);
  assert.match(String(describeCeremonyFailure(new Error("boom"))), /could not/i);
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `node --import tsx --test apps/web/test/ceremony.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the ceremony**

```ts
// Ported from Relayer apps/web/components/passkey/passkey-setup-flow.tsx and
// apps/web/hooks/use-add-passkey.ts (commit bb6bb1226e92). Changed: the ceremony is a function
// over a CredentialsContainer rather than a hook, so it can be tested without a browser.

"use client";

import type { AttestationDto, ChallengeOptionsDto } from "./custody-api";
import { base64urlToBuffer, bufferToBase64url, normalizeTransports } from "./webauthn";

export type Attachment = "platform" | "cross-platform";

export async function createPasskey(
  credentials: CredentialsContainer,
  options: ChallengeOptionsDto,
  attachment: Attachment,
): Promise<AttestationDto> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams.map((p) => ({
      type: p.type as PublicKeyCredentialType,
      alg: p.alg,
    })),
    authenticatorSelection: {
      authenticatorAttachment: attachment,
      residentKey: (options.authenticatorSelection?.residentKey ?? "preferred") as ResidentKeyRequirement,
      userVerification: (options.authenticatorSelection?.userVerification ??
        "preferred") as UserVerificationRequirement,
    },
    ...(options.timeout ? { timeout: options.timeout } : {}),
    attestation: (options.attestation ?? "none") as AttestationConveyancePreference,
    // Without this the browser will happily mint a second credential on an authenticator that
    // already holds one, and the person ends up with two passkeys for one account.
    ...(options.excludeCredentials?.length
      ? {
          excludeCredentials: options.excludeCredentials.map((c) => ({
            id: base64urlToBuffer(c.id),
            type: c.type,
            ...(c.transports ? { transports: c.transports as AuthenticatorTransport[] } : {}),
          })),
        }
      : {}),
  };

  const credential = (await credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!credential) {
    throw new Error("The browser did not return a passkey");
  }
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    credentialId: credential.id,
    clientDataJson: bufferToBase64url(response.clientDataJSON),
    attestationObject: bufferToBase64url(response.attestationObject),
    transports: normalizeTransports(response.getTransports?.()),
  };
}

/**
 * Copy for a failed ceremony, or null when the person simply cancelled — a cancellation is a
 * decision, not an error, and showing a red banner for it is rude.
 */
export function describeCeremonyFailure(error: unknown): string | null {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
      return null;
    case "InvalidStateError":
      return "This device already has a passkey for your account. Use it to sign in.";
    case "SecurityError":
      return "Passkeys cannot be created from this address. Open Pickler on its own domain.";
    case "NotSupportedError":
      return "This device does not support the kind of passkey Pickler needs.";
    default:
      return "We could not finish setting up your passkey. Try again.";
  }
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `node --import tsx --test apps/web/test/ceremony.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/auth/lib/ apps/web/test/ceremony.test.ts
git commit -m "Run the passkey ceremony somewhere a test can watch"
```

---

## Task 14: The step machine

**Files:**
- Create: `apps/web/src/features/auth/lib/flow.ts`
- Test: `apps/web/test/flow.test.ts`

The design's `STEPS`, `RAILS` and `TABS` are data. Keeping them out of React means the transitions can be tested directly.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL, next, rail, type FlowState } from "../src/features/auth/lib/flow";

test("sign-up walks account, code, handle, passkey, wallet", () => {
  let state: FlowState = { ...INITIAL, mode: "up" };
  const seen: string[] = [state.step];
  for (const event of ["code_sent", "code_verified", "handle_claimed", "passkey_created"] as const) {
    state = next(state, event);
    seen.push(state.step);
  }
  assert.deepEqual(seen, ["auth", "code", "handle", "passkey", "wallet"]);
});

test("a returning person skips the handle and lands on welcome", () => {
  let state: FlowState = { ...INITIAL, mode: "in" };
  state = next(state, "code_sent");
  state = next(state, "code_verified");
  assert.equal(state.step, "welcome");
});

test("a signed-in person with no passkey on this device is offered the new-device path", () => {
  const state = next({ ...INITIAL, mode: "in", step: "code" }, "device_unknown");
  assert.equal(state.step, "recover");
  assert.equal(state.mode, "recover");
});

test("changing the email goes back to the account screen and forgets the code", () => {
  const state = next({ ...INITIAL, step: "code", code: "123456" }, "change_email");
  assert.equal(state.step, "auth");
  assert.equal(state.code, "");
});

test("the rail marks the current phase and every phase before it", () => {
  assert.deepEqual(
    rail({ ...INITIAL, mode: "up", step: "passkey" }).map((r) => [r.label, r.done]),
    [
      ["ACCOUNT", true],
      ["HANDLE", true],
      ["PASSKEY", false],
      ["BACKUP", false],
    ],
  );
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test apps/web/test/flow.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the machine**

```ts
/**
 * Transcribed from the `STEPS` and `RAILS` constants of the design canvas
 * (Pickler Auth Passkey Flow.dc.html). The canvas drives these from a demo tab strip; here the
 * only things that move the flow are events the person causes.
 */

export type Step =
  | "auth"
  | "code"
  | "handle"
  | "passkey"
  | "wallet"
  | "welcome"
  | "recover"
  | "approve"
  | "recovered";

export type Mode = "up" | "in" | "recover";

export interface FlowState {
  mode: Mode;
  step: Step;
  email: string;
  code: string;
  handle: string;
  address: string | null;
}

export type FlowEvent =
  | "code_sent"
  | "code_verified"
  | "handle_claimed"
  | "passkey_created"
  | "backup_added"
  | "device_unknown"
  | "approve_started"
  | "device_added"
  | "change_email";

export const INITIAL: FlowState = {
  mode: "up",
  step: "auth",
  email: "",
  code: "",
  handle: "",
  address: null,
};

const RAILS: Record<Mode, { label: string; steps: Step[] }[]> = {
  up: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "HANDLE", steps: ["handle"] },
    { label: "PASSKEY", steps: ["passkey"] },
    { label: "BACKUP", steps: ["wallet"] },
  ],
  in: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "IN", steps: ["welcome"] },
  ],
  recover: [
    { label: "SIGNED IN", steps: ["recover"] },
    { label: "APPROVE", steps: ["approve"] },
    { label: "THIS DEVICE", steps: ["recovered"] },
  ],
};

export function next(state: FlowState, event: FlowEvent): FlowState {
  switch (event) {
    case "code_sent":
      return { ...state, step: "code" };
    case "code_verified":
      return { ...state, step: state.mode === "up" ? "handle" : "welcome" };
    case "handle_claimed":
      return { ...state, step: "passkey" };
    case "passkey_created":
      return { ...state, step: "wallet" };
    case "backup_added":
      return state;
    case "device_unknown":
      return { ...state, mode: "recover", step: "recover" };
    case "approve_started":
      return { ...state, step: "approve" };
    case "device_added":
      return { ...state, step: "recovered" };
    case "change_email":
      return { ...state, step: "auth", code: "" };
    default:
      return state;
  }
}

export function rail(state: FlowState) {
  const phases = RAILS[state.mode];
  const current = phases.findIndex((phase) => phase.steps.includes(state.step));
  return phases.map((phase, index) => ({
    label: phase.label,
    active: index === current,
    done: current === -1 ? false : index < current,
  }));
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test apps/web/test/flow.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/lib/flow.ts apps/web/test/flow.test.ts
git commit -m "Give the flow a shape that does not need a browser"
```

---

## Task 15: Account and code screens

**Files:**
- Create: `apps/web/src/features/auth/components/steps/account-step.tsx`
- Create: `apps/web/src/features/auth/components/steps/code-step.tsx`
- Modify: `apps/web/src/features/auth/lib/account.ts`
- Modify: `apps/web/src/features/auth/auth.module.css`

- [ ] **Step 1: Replace the account helpers**

In `apps/web/src/features/auth/lib/account.ts`, delete `signUpWithEmail` and `signInWithWallet`, and add:

```ts
/** Google and X. The PKCE code lands on /auth/callback, which already exists. */
export async function signInWithProvider(
  supabase: SupabaseClient,
  provider: "google" | "twitter",
): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Sends the six-digit code. `shouldCreateUser` is what makes this work for sign-up too. */
export async function sendEmailCode(supabase: SupabaseClient, email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Exchanges the code for a session. Returns false when the code is simply wrong. */
export async function verifyEmailCode(
  supabase: SupabaseClient,
  email: string,
  code: string,
): Promise<boolean> {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
  if (!error) {
    return true;
  }
  if (/expired|invalid|token/i.test(error.message)) {
    return false;
  }
  throw new Error(error.message);
}
```

Delete `apps/web/src/features/auth/lib/password.ts` and remove its import from anywhere that still references it.

- [ ] **Step 2: Write the account screen**

```tsx
"use client";

import { Button, Icon, Input } from "@pickler/ui";
import styles from "../../auth.module.css";

/** X needs credentials configured on the Supabase project; without them the button is hidden
 *  rather than shown dead. */
const X_ENABLED = process.env.NEXT_PUBLIC_OAUTH_X_ENABLED === "true";

export function AccountStep({
  mode,
  email,
  busy,
  error,
  onEmail,
  onProvider,
  onSend,
  onMode,
}: {
  mode: "up" | "in";
  email: string;
  busy: boolean;
  error: string | null;
  onEmail: (value: string) => void;
  onProvider: (provider: "google" | "twitter") => void;
  onSend: () => void;
  onMode: (mode: "up" | "in") => void;
}) {
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <div className={styles.step}>
      <h1 className={styles.headline}>{mode === "up" ? "Start here" : "Welcome back"}.</h1>

      <div className={styles.modes} role="tablist">
        {(["up", "in"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? styles.modeOn : styles.mode}
            onClick={() => onMode(value)}
          >
            {value === "up" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>

      <div className={styles.providers}>
        <Button variant="tile" onClick={() => onProvider("google")} disabled={busy}>
          <Icon name="google" size={18} />
          Google
        </Button>
        {X_ENABLED && (
          <Button variant="tile" onClick={() => onProvider("twitter")} disabled={busy}>
            <Icon name="x" size={16} />X
          </Button>
        )}
      </div>

      <div className={styles.divider}>
        <span>OR EMAIL</span>
      </div>

      <div className={styles.emailRow}>
        <Input
          type="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
        />
        <Button onClick={onSend} disabled={!valid || busy}>
          {busy ? "Sending…" : "Send code"}
        </Button>
      </div>

      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

If `@pickler/ui`'s `Icon` has no `google` or `x` names, add them to `packages/ui/src/icon.tsx` using the two SVG paths from the design file (`Pickler Auth Passkey Flow.dc.html`, the `AUTH` block), and export the names from `ICON_NAMES`.

- [ ] **Step 3: Write the code screen**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Button } from "@pickler/ui";
import styles from "../../auth.module.css";

export function CodeStep({
  email,
  code,
  verifying,
  wrong,
  triesLeft,
  onCode,
  onBack,
  onResend,
  resendIn,
}: {
  email: string;
  code: string;
  verifying: boolean;
  wrong: boolean;
  triesLeft: number;
  onCode: (value: string) => void;
  onBack: () => void;
  onResend: () => void;
  resendIn: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <div className={styles.step}>
      <h1 className={styles.headline}>Check your email.</h1>
      <p className={styles.eyebrow}>6 DIGITS · {email.toUpperCase()}</p>

      <div className={styles.cells} onClick={() => input.current?.focus()}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={styles.cell} data-filled={code[i] ? "true" : undefined}>
            {code[i] ?? ""}
          </span>
        ))}
        <input
          ref={input}
          className={styles.cellInput}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-label="Code"
          value={code}
          onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>

      {wrong && (
        <p className={styles.alert} role="alert">
          That code doesn&apos;t match. {triesLeft} {triesLeft === 1 ? "try" : "tries"} left.
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onBack}>
          ← Change
        </Button>
        {verifying && <span className={styles.eyebrow}>VERIFYING</span>}
        <Button variant="secondary" size="sm" onClick={onResend} disabled={resendIn > 0}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `apps/web/src/features/auth/auth.module.css` classes for `.step`, `.modes`, `.mode`, `.modeOn`, `.providers`, `.divider`, `.emailRow`, `.cells`, `.cell`, `.cellInput`. Take the values from the design file: background `#0B0D1A`, accent `#C8F03A`, muted text `#5A5F78`, panel `#15182A`, 14px radius on controls. `.cellInput` is positioned over the cells with `opacity: 0` so the caret is the operating system's but the boxes are ours.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add apps/web/src/features/auth packages/ui
git commit -m "Ask for an address and six digits, not a password"
```

---

## Task 16: Handle screen

**Files:**
- Create: `apps/web/src/features/auth/components/steps/handle-step.tsx`

- [ ] **Step 1: Write the screen**

Reuse the availability check that already exists: `checkHandle` from `apps/web/src/features/auth/lib/pickler-api.ts`, and the debounce shape from `useHandleCheck` in the current `sign-up-flow.tsx` (lines 36–62). Move that hook into this file unchanged rather than rewriting it.

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, type FieldTone } from "@pickler/ui";
import { checkHandle, type HandleAvailability } from "../../lib/pickler-api";
import styles from "../../auth.module.css";

const REASONS: Record<Exclude<HandleAvailability, { available: true }>["reason"], string> = {
  too_short: "Too short.",
  too_long: "15 characters at most.",
  invalid_characters: "Letters, numbers and underscores only.",
  reserved: "That handle is reserved.",
  taken: "is taken.",
};

function useHandleCheck(handle: string) {
  const [result, setResult] = useState<{ handle: string; state: HandleAvailability | "error" } | null>(
    null,
  );
  useEffect(() => {
    if (handle.length < 3) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setResult({ handle, state: await checkHandle(handle, controller.signal) });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ handle, state: "error" });
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle]);
  return result?.handle === handle ? result.state : null;
}

export function HandleStep({
  handle,
  busy,
  onHandle,
  onContinue,
}: {
  handle: string;
  busy: boolean;
  onHandle: (value: string) => void;
  onContinue: () => void;
}) {
  const availability = useHandleCheck(handle);
  const ok = typeof availability === "object" && availability.available;

  const note: { text: string; tone: FieldTone } = !handle
    ? { text: "3–15 characters, letters, numbers and underscores.", tone: "quiet" }
    : handle.length < 3
      ? { text: "Too short.", tone: "warn" }
      : availability === null
        ? { text: `Checking @${handle}…`, tone: "quiet" }
        : availability === "error"
          ? { text: "Could not check this handle. Try again.", tone: "warn" }
          : availability.available
            ? { text: `@${handle} is available.`, tone: "good" }
            : {
                text:
                  availability.reason === "taken"
                    ? `@${handle} is taken.`
                    : REASONS[availability.reason],
                tone: "bad",
              };

  return (
    <div className={styles.step}>
      <h1 className={styles.headline}>Pick a handle.</h1>
      <Field label="HANDLE" note={note.text} tone={note.tone}>
        <Input
          prefix="@"
          mono
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
          placeholder="nightowl"
          maxLength={15}
          value={handle}
          onChange={(e) => onHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
          invalid={note.tone === "bad"}
        />
      </Field>
      <p className={styles.cardNote}>
        This is the name on every pick your agents post. Agents get their own handle later.
      </p>
      <Button className={styles.primary} onClick={onContinue} disabled={!ok || busy} arrow>
        {busy ? "Claiming…" : "Continue"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/web/src/features/auth/components/steps/handle-step.tsx
git commit -m "Claim a name before a wallet exists to attach it to"
```

---

## Task 17: Passkey screen and the ceremony sheet

**Files:**
- Create: `apps/web/src/features/auth/components/passkey-sheet.tsx`
- Create: `apps/web/src/features/auth/components/steps/passkey-step.tsx`

- [ ] **Step 1: Write the sheet**

```tsx
"use client";

import { Button } from "@pickler/ui";
import styles from "../auth.module.css";

export type SheetPhase = "idle" | "busy" | "ok" | "error";

/** Shared by every ceremony in this flow: first passkey, backup passkey, new device. */
export function PasskeySheet({
  open,
  phase,
  title,
  body,
  error,
  onConfirm,
  onCancel,
  onRetry,
}: {
  open: boolean;
  phase: SheetPhase;
  title: string;
  body: string;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className={styles.sheetScrim} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.sheet}>
        <p className={styles.sheetTitle}>{title}</p>
        <p className={styles.sheetBody}>{phase === "error" ? (error ?? body) : body}</p>

        {phase === "idle" && (
          <div className={styles.sheetActions}>
            <Button className={styles.primary} onClick={onConfirm}>
              Continue
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}

        {phase === "busy" && (
          <p className={styles.eyebrow} aria-live="polite">
            WAITING FOR YOUR DEVICE
          </p>
        )}

        {phase === "error" && (
          <div className={styles.sheetActions}>
            <Button className={styles.primary} onClick={onRetry}>
              Try again
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the passkey screen**

The three custody points and the headline are the design's, verbatim.

```tsx
"use client";

import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";

const POINTS = [
  { title: "Your passkey signs every payment", tag: "ON THIS DEVICE" },
  { title: "Pickler cannot move your funds", tag: "NO KEYS HELD" },
  { title: "Nothing leaves without your approval", tag: "EVERY TIME" },
];

export function PasskeyStep({ onCreate, busy }: { onCreate: () => void; busy: boolean }) {
  return (
    <div className={styles.step}>
      <h1 className={styles.headline}>
        Your key.
        <br />
        Not ours.
      </h1>
      <p className={styles.subhead}>
        Your passkey signs every payment. Without it, no one moves your funds.
      </p>

      <ul className={styles.points}>
        {POINTS.map((point) => (
          <li key={point.title} className={styles.point}>
            <span>{point.title}</span>
            <span className={styles.tag}>{point.tag}</span>
          </li>
        ))}
      </ul>

      <Button className={styles.primary} onClick={onCreate} disabled={busy}>
        <Icon name="key" size={19} />
        {busy ? "Waiting for your device…" : "Create passkey"}
      </Button>
      <p className={styles.eyebrow}>KEEP IT SAFE · WE CAN&apos;T RECOVER IT</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add apps/web/src/features/auth/components/
git commit -m "Say plainly whose key it is"
```

---

## Task 18: Wallet, welcome and new-device screens

**Files:**
- Create: `apps/web/src/features/auth/components/steps/wallet-step.tsx`
- Create: `apps/web/src/features/auth/components/steps/welcome-step.tsx`
- Create: `apps/web/src/features/auth/components/steps/new-device-step.tsx`

- [ ] **Step 1: Write the wallet screen**

```tsx
"use client";

import { useState } from "react";
import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function WalletStep({
  address,
  deviceLabel,
  hasBackup,
  busy,
  onAddBackup,
  onFinish,
}: {
  address: string;
  deviceLabel: string;
  hasBackup: boolean;
  busy: boolean;
  onAddBackup: () => void;
  onFinish: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={styles.step}>
      <p className={styles.created}>
        <Icon name="check" size={14} /> Wallet created
        <button
          className={styles.address}
          onClick={async () => {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : shorten(address)}
        </button>
      </p>

      <h1 className={styles.headline}>Add a backup.</h1>
      <p className={styles.subhead}>
        Lose your only passkey and your funds stay locked. A second one, somewhere else, keeps you
        in.
      </p>

      <ul className={styles.points}>
        <li className={styles.point}>
          <span>{deviceLabel}</span>
          <span className={styles.tag}>SAVED</span>
        </li>
        <li className={styles.point}>
          <span>{hasBackup ? "Backup passkey" : "No backup yet"}</span>
          <span className={styles.tag}>{hasBackup ? "SAVED" : "RECOMMENDED"}</span>
        </li>
      </ul>

      {!hasBackup && (
        <Button className={styles.primary} onClick={onAddBackup} disabled={busy}>
          <Icon name="key" size={19} />
          Add backup passkey
        </Button>
      )}
      <Button variant="secondary" onClick={onFinish} arrow>
        {hasBackup ? "Open the studio" : "Skip for now"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write the welcome screen**

`raw` is base units; `null` means the chain could not be read and the screen says so rather than
showing a zero.

```tsx
"use client";

import { ButtonLink, Icon } from "@pickler/ui";
import type { WalletDto } from "../../lib/custody-api";
import styles from "../../auth.module.css";

function amount(balance: { decimals: number; raw: string | null } | undefined) {
  if (!balance?.raw) {
    return null;
  }
  const value = BigInt(balance.raw);
  const unit = 10n ** BigInt(balance.decimals);
  const whole = value / unit;
  const cents = ((value % unit) * 100n) / unit;
  return `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function WelcomeStep({ handle, wallet }: { handle: string; wallet: WalletDto | null }) {
  const token = amount(wallet?.balances?.token);
  const native = amount(wallet?.balances?.native);

  return (
    <div className={styles.step}>
      <h1 className={styles.headline}>Welcome back.</h1>
      <p className={styles.eyebrow}>@{handle.toUpperCase()}</p>

      <div className={styles.balanceCard}>
        <p className={styles.eyebrow}>
          MASTER WALLET
          <span className={styles.tag}>
            <Icon name="lock" size={11} /> PASSKEY TO MOVE
          </span>
        </p>
        {token === null ? (
          <p className={styles.balanceUnknown}>Balance unavailable right now</p>
        ) : (
          <>
            <p className={styles.balance}>
              {token} <span>{wallet?.balances?.token.symbol}</span>
            </p>
            {native !== null && (
              <p className={styles.balanceSecondary}>
                + {native} {wallet?.balances?.native.symbol}
              </p>
            )}
          </>
        )}
      </div>

      <ButtonLink href="/console" className={styles.primary} arrow>
        Open the studio
      </ButtonLink>
    </div>
  );
}
```

- [ ] **Step 3: Write the new-device screen**

Both ceremony steps sit behind one button, because the new credential must exist before an
existing passkey can stamp the activity that adds it.

```tsx
"use client";

import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";

export function NewDeviceStep({
  phase,
  onUsePhone,
}: {
  phase: "idle" | "creating" | "verifying";
  onUsePhone: () => void;
}) {
  return (
    <div className={styles.step}>
      <h1 className={styles.headline}>New device.</h1>
      <p className={styles.subhead}>
        You&apos;re in. To move funds here, approve with a passkey you already have.
      </p>

      <Button className={styles.primary} onClick={onUsePhone} disabled={phase !== "idle"}>
        <span className={styles.tileText}>
          <strong>Use my phone</strong>
          <span>
            {phase === "creating"
              ? "SAVING A PASSKEY ON THIS DEVICE · STEP 1 OF 2"
              : phase === "verifying"
                ? "SCAN THE CODE AND APPROVE · STEP 2 OF 2"
                : "SCAN A CODE · APPROVE WITH ITS PASSKEY"}
          </span>
        </span>
        <Icon name="arrow-right" size={16} />
      </Button>

      <p className={styles.point}>
        <span>Recover by email</span>
        <span className={styles.tag}>OFF · TURN ON IN SECURITY</span>
      </p>

      <details className={styles.lost}>
        <summary>I&apos;ve lost every passkey</summary>
        <p>No passkey, no way to move funds. Not even for us.</p>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add apps/web/src/features/auth/components/steps/
git commit -m "Show the wallet, the backup it wants, and the way back in"
```

---

## Task 19: The shell that drives them

**Files:**
- Create: `apps/web/src/features/auth/components/auth-flow.tsx`

- [ ] **Step 1: Write the shell**

```tsx
"use client";

import { useCallback, useState } from "react";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import type { AuthBoardData } from "../lib/board-data";
import { ensureProfile, sendEmailCode, signInWithProvider, verifyEmailCode } from "../lib/account";
import { custodyClient, type WalletDto } from "../lib/custody-api";
import { createPasskey, describeCeremonyFailure, type Attachment } from "../lib/ceremony";
import { INITIAL, next, rail, type FlowState, type Mode } from "../lib/flow";
import { getSupabase } from "../lib/supabase-browser";
import { AuthHeader } from "./auth-header";
import { PasskeySheet, type SheetPhase } from "./passkey-sheet";
import { SpawnBoard } from "./spawn-board";
import { AccountStep } from "./steps/account-step";
import { CodeStep } from "./steps/code-step";
import { HandleStep } from "./steps/handle-step";
import { PasskeyStep } from "./steps/passkey-step";
import { WalletStep } from "./steps/wallet-step";
import { WelcomeStep } from "./steps/welcome-step";
import { NewDeviceStep } from "./steps/new-device-step";
import styles from "../auth.module.css";

function deviceLabel(): string {
  if (typeof navigator === "undefined") {
    return "This device";
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return "Face ID on iPhone";
  if (/Android/i.test(ua)) return "Fingerprint on Android";
  if (/Mac/i.test(ua)) return "Touch ID on this Mac";
  if (/Win/i.test(ua)) return "Windows Hello on this PC";
  return "Passkey on this device";
}

export function AuthFlow({ board, mode: initialMode }: { board: AuthBoardData; mode: Mode }) {
  const [state, setState] = useState<FlowState>({ ...INITIAL, mode: initialMode });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [triesLeft, setTriesLeft] = useState(3);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; phase: SheetPhase; attachment: Attachment }>({
    open: false,
    phase: "idle",
    attachment: "platform",
  });

  const token = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    if (!data.session) {
      throw new Error("Your session expired. Sign in again.");
    }
    return data.session.access_token;
  }, []);

  /** The one ceremony: create a credential, then either register it or have a phone approve it. */
  const runCeremony = useCallback(
    async (attachment: Attachment, label: string) => {
      const access = await token();
      const options = await custodyClient.challenge(access);
      const attestation = await createPasskey(navigator.credentials, options, attachment);
      if (!wallet) {
        const created = await custodyClient.register(access, {
          label,
          challenge: options.challenge,
          attestation,
        });
        setWallet(created);
        return;
      }
      const activity = await custodyClient.prepareAdd(access, {
        label,
        challenge: options.challenge,
        attestation,
      });
      const stamper = new WebauthnStamper({ rpId: options.rp.id });
      const stamp = await stamper.stamp(activity.body);
      await custodyClient.confirmAdd(access, {
        label,
        credential_id: attestation.credentialId,
        transports: attestation.transports,
        signed: { url: activity.url, body: activity.body, stamp },
      });
      setHasBackup(true);
    },
    [token, wallet],
  );

  const confirmSheet = useCallback(async () => {
    setSheet((s) => ({ ...s, phase: "busy" }));
    setError(null);
    try {
      await runCeremony(
        sheet.attachment,
        sheet.attachment === "platform" ? deviceLabel() : "Phone passkey",
      );
      setSheet({ open: false, phase: "idle", attachment: sheet.attachment });
      setState((s) => next(s, wallet ? "backup_added" : "passkey_created"));
    } catch (caught) {
      const message = describeCeremonyFailure(caught);
      if (message === null) {
        setSheet({ open: false, phase: "idle", attachment: sheet.attachment });
        return;
      }
      setError(message);
      setSheet((s) => ({ ...s, phase: "error" }));
    }
  }, [runCeremony, sheet.attachment, wallet]);

  async function guard(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const supabase = getSupabase();

  return (
    <>
      <AuthHeader view={state.mode === "up" ? "signup" : "signin"} />
      <main className={styles.signup}>
        <div className={styles.formColumn}>
          <ol className={styles.rail}>
            {rail(state).map((phase) => (
              <li key={phase.label} data-active={phase.active} data-done={phase.done}>
                {phase.label}
              </li>
            ))}
          </ol>

          {state.step === "auth" && (
            <AccountStep
              mode={state.mode === "recover" ? "in" : state.mode}
              email={state.email}
              busy={busy}
              error={error}
              onEmail={(email) => setState((s) => ({ ...s, email }))}
              onMode={(mode) => setState((s) => ({ ...s, mode }))}
              onProvider={(provider) =>
                guard(async () => {
                  if (supabase) await signInWithProvider(supabase, provider);
                })
              }
              onSend={() =>
                guard(async () => {
                  if (!supabase) throw new Error("Sign-in is not connected here yet.");
                  await sendEmailCode(supabase, state.email);
                  setState((s) => next(s, "code_sent"));
                })
              }
            />
          )}

          {state.step === "code" && (
            <CodeStep
              email={state.email}
              code={state.code}
              verifying={busy}
              wrong={wrong}
              triesLeft={triesLeft}
              resendIn={0}
              onBack={() => setState((s) => next(s, "change_email"))}
              onResend={() => guard(async () => supabase && sendEmailCode(supabase, state.email))}
              onCode={(code) => {
                setState((s) => ({ ...s, code }));
                setWrong(false);
                if (code.length !== 6 || !supabase) return;
                void guard(async () => {
                  if (!(await verifyEmailCode(supabase, state.email, code))) {
                    setWrong(true);
                    setTriesLeft((n) => Math.max(0, n - 1));
                    return;
                  }
                  const access = await token();
                  const existing = await custodyClient.wallet(access).catch(() => null);
                  setWallet(existing);
                  // Signed in, account already has custody, but this browser has no passkey:
                  // that is the new-device path, not a fresh sign-up.
                  if (existing && state.mode === "in") {
                    setState((s) => next(s, "device_unknown"));
                    return;
                  }
                  setState((s) => next(s, "code_verified"));
                });
              }}
            />
          )}

          {state.step === "handle" && (
            <HandleStep
              handle={state.handle}
              busy={busy}
              onHandle={(handle) => setState((s) => ({ ...s, handle }))}
              onContinue={() =>
                guard(async () => {
                  if (!supabase) throw new Error("Sign-up is not connected here yet.");
                  await ensureProfile(supabase, {
                    displayName: state.handle,
                    handle: state.handle,
                  });
                  setState((s) => next(s, "handle_claimed"));
                })
              }
            />
          )}

          {state.step === "passkey" && (
            <PasskeyStep
              busy={sheet.open}
              onCreate={() => setSheet({ open: true, phase: "idle", attachment: "platform" })}
            />
          )}

          {state.step === "wallet" && wallet && (
            <WalletStep
              address={wallet.address}
              deviceLabel={deviceLabel()}
              hasBackup={hasBackup}
              busy={sheet.open}
              onAddBackup={() =>
                setSheet({ open: true, phase: "idle", attachment: "cross-platform" })
              }
              onFinish={() => {
                window.location.href = "/console";
              }}
            />
          )}

          {state.step === "welcome" && <WelcomeStep handle={state.handle} wallet={wallet} />}

          {state.step === "recover" && (
            <NewDeviceStep
              phase={sheet.open ? "verifying" : "idle"}
              onUsePhone={() =>
                setSheet({ open: true, phase: "idle", attachment: "cross-platform" })
              }
            />
          )}
        </div>

        <SpawnBoard board={board} />
      </main>

      <PasskeySheet
        open={sheet.open}
        phase={sheet.phase}
        title={
          sheet.attachment === "platform" ? "Create your passkey" : "Approve with another device"
        }
        body={
          sheet.attachment === "platform"
            ? "Your device will ask for your fingerprint, face or PIN. Pickler never sees it."
            : "Your device will show a code. Scan it with the phone that holds your passkey."
        }
        error={error}
        onConfirm={() => void confirmSheet()}
        onRetry={() => void confirmSheet()}
        onCancel={() => setSheet({ open: false, phase: "idle", attachment: sheet.attachment })}
      />
    </>
  );
}
```

- [ ] **Step 2: Add the dependency**

Run: `npm install @turnkey/webauthn-stamper --workspace=@pickler/web`
Expected: `apps/web/package.json` gains the dependency.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add apps/web/
git commit -m "Drive every screen from one ceremony"
```

---

## Task 20: Wire the pages and delete what it replaces

**Files:**
- Modify: `apps/web/src/app/(auth)/signup/page.tsx`, `apps/web/src/app/(auth)/signin/page.tsx`
- Delete: `apps/web/src/features/auth/components/sign-up-flow.tsx`, `apps/web/src/features/auth/components/sign-in-card.tsx`

- [ ] **Step 1: Point the pages at the flow**

`signup/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuthFlow } from "@/features/auth/components/auth-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account — Pickler" };

export default async function SignUpPage() {
  return <AuthFlow board={toAuthBoardData(await services.getLanding())} mode="up" />;
}
```

`signin/page.tsx` is the same with `mode="in"` and the title `"Sign in — Pickler"`.

- [ ] **Step 2: Delete the old components**

```bash
git rm apps/web/src/features/auth/components/sign-up-flow.tsx apps/web/src/features/auth/components/sign-in-card.tsx
```

Then remove any now-unused exports they were the only consumers of: check `done-view.tsx` and
`board-now.tsx` with `grep -rn "DoneView\|BoardNow" apps/web/src`, and delete whichever has no
remaining reference.

- [ ] **Step 3: Verify nothing dangles**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no type errors, no lint errors, all tests pass.

Run: `grep -rn "signUpWithEmail\|signInWithWallet\|passwordScore\|PASSWORD_MIN" apps/web/src`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web
git commit -m "Retire the password the passkey made pointless"
```

---

## Task 21: Prove it against a real browser and real Turnkey

**Files:** none changed unless a defect appears.

- [ ] **Step 1: Configure the local environment**

Copy `workers/api/.dev.vars.example` to `workers/api/.dev.vars` and fill it from the Turnkey
dashboard. Set `TURNKEY_RPID=localhost`. Enable Google OAuth and email OTP on the Supabase project.

- [ ] **Step 2: Start everything**

Run: `npm run db:up && npm run db:migrate && npm run dev`
Expected: the site serves on `http://localhost:3000`.

- [ ] **Step 3: Walk sign-up**

Open `http://localhost:3000/signup`, enter an email, take the six-digit code from the Supabase
dashboard's auth logs, claim a handle, then create the passkey.

Expected: the operating system prompts once; the wallet screen shows a `0x…` address; and
`psql -c "select * from wallets.turnkey_orgs"` returns exactly one row. Check the Turnkey dashboard:
the new sub-organization has one root user, one authenticator, and **no API keys**.

- [ ] **Step 4: Prove the retry does nothing**

Reload `/signup` while signed in and reach the passkey screen again.
Expected: no second sub-organization in Turnkey, and still one row in `wallets.turnkey_orgs`.

- [ ] **Step 5: Walk the new device**

Open the site in a different browser profile, sign in with the same email, and choose "Use my
phone".
Expected: the browser creates a local passkey, then shows the operating system's own QR; scanning
it with the phone that holds the first passkey completes the flow, and
`select count(*) from wallets.passkeys` returns 2.

- [ ] **Step 6: Record the result**

Write what happened into `docs/specs/turnkey-passkey-custody-v1.md` under a new
`## 12. Validation` section: date, what was exercised, and anything that behaved differently from
this plan. Commit.

```bash
git add docs/specs/turnkey-passkey-custody-v1.md
git commit -m "Record what the first real passkey did"
```

---

## What this plan does not do

Agent sub-wallets, the agent co-signer user, the passkey-signed policy round and the two-of-two
policy. Those are specification two. Until they exist, a sub-organization created by this plan runs
with root-quorum default-allow: safe for one person holding their own funds, and not a spending
limit. No copy added by this plan may suggest otherwise.

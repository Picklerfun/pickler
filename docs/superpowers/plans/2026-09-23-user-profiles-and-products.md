# User Profiles and the Product Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the marketplace and the studio from two hostnames out of one application, and let a
person sign in with a wallet into the same Supabase account their passkey and profile already hang
off.

**Architecture:** A pure host-mapping function behind a Next.js middleware splits the products. A
Sign-In With Ethereum ceremony — nonce, signature, verification — mints a Supabase session and
writes a row to `identity.wallet_links`, a table that already exists and that nothing has ever
used. Core holds the rules with no viem, no Supabase and no HTTP; infrastructure holds the three
adapters; the Worker mounts three routes.

**Tech Stack:** Next.js 16 middleware, Hono on Cloudflare Workers, PostgreSQL via `pg`, Drizzle for
schema, `viem/siwe` for message and signature, `@supabase/supabase-js` admin client, `node:test`
with `tsx`.

**Spec:** `docs/specs/user-profiles-and-products-v1.md`

---

## Orientation

Read this before Task 1. It is what the tasks assume you know.

**Things that already exist and must be used rather than rebuilt.**

1. **`identity.wallet_links`** — declared in
   `packages/infrastructure/src/persistence/product/identity.ts:94`, present in migration `0006`
   with a foreign key to `auth.users(id) on delete cascade`, and **read or written by no source
   file in this repository**. Its columns are `id, user_id, namespace, verified_chain, address,
method, kind, verified_at`; it is unique on `(namespace, address)`; `namespace` is
   `eip155|solana`, `method` is `siwe|siws`, `kind` is `external|mera`, and the address format is
   checked per namespace. Do not add a table beside it.

2. **The profile feature** — `packages/core/src/features/profiles/` with `createProfileService`,
   `HANDLE_RULES`, `RESERVED_HANDLES`, and the routes `/v1/handles/:handle/availability` and
   `/v1/profile` already mounted in `workers/api/src/app.ts`. No change is needed to any of it.

3. **The single-use challenge pattern** — `packages/infrastructure/src/persistence/custody-store.ts:140`
   consumes a WebAuthn challenge with one `DELETE … RETURNING` statement so two concurrent readers
   cannot both receive it. The nonce store copies this exactly. Workers has no Redis; this is the
   settled answer.

4. **`authenticated(...)`** — `workers/api/src/middleware/auth.ts`, used as
   `api.use("*", authenticated(services.authenticate, { userOnly: true }))` in
   `workers/api/src/routes/signing.ts:168`. The nonce and verify routes are **public**; the link
   route is behind it.

5. **`identity` is already in `schemaFilter`** in `packages/infrastructure/drizzle.config.ts`.
   Adding a table to that schema needs no configuration change. The custody work nearly shipped an
   empty migration by forgetting the equivalent for `wallets`, so this is stated rather than
   assumed.

**Commands.**

| What                 | How                                                               |
| -------------------- | ----------------------------------------------------------------- |
| Every test           | `npm test`                                                        |
| One file             | `node --import tsx --test packages/core/test/wallet-auth.test.ts` |
| Types                | `npm run typecheck`                                               |
| Lint and format      | `npm run lint` · `npx prettier --check .`                         |
| Generate a migration | `cd packages/infrastructure && npx drizzle-kit generate`          |

**The dev server is already running on port 3001 and it serves this worktree.** Do not start your
own with `npm run dev`: ports 3000 and 3002 have both been taken by other checkouts or other
agents during this work, so a second server lands on whichever port is free and comes up without
whatever the running one has behind it. An agent on this plan started one, got four 500s, and had
to prove the failures were not theirs. Use `http://localhost:3001`, and if it is not answering,
say so rather than starting a replacement — a server that looks like ours and is not is the same
hazard as the design checks measuring another branch.

The API worker is **not** running, so routes that call it may answer 500 with
`Pickler API request failed (503)`. That is the environment, not your change. The way to tell them
apart is what that agent did: move your file aside, re-request, and compare — byte-identical
output proves the failure was already there.

**Commit by path, always:** `git commit -m "..." -- <paths>`. Several agents share this worktree's
index; bare `git commit` commits whatever is staged, including someone else's work. Never
`git clean`, `git checkout .` or `git reset --hard`.

**Lessons carried from the two specifications before this one.**

1. **Prove a test can fail before believing it.** The custody work found a race test that passed
   with the race handling deleted. Every test in this plan that guards a rule has a step that
   breaks the implementation and confirms exactly that test goes red.
2. **A test that passes under both the right and the wrong implementation is not a test of that
   implementation.** Choose the case that distinguishes them, not the one that is easiest to write.
3. **Failure must propagate where absence and error mean different things.** "This account has no
   linked wallets" and "we could not read them" are different facts and only one is safe to render.
4. **Typecheck cannot see a route that 500s.** Before reporting a task done, request the route.
5. **Assert the behaviour, not the description of it.** This plan has specified the wrong test
   three times, always the same way: `decide()` asserted a data structure while the routing lived
   in a branch above it; `stepsFor("up")` asserted a list of rail labels while the progression was
   hardwired in `next()`. Both went green with the defect present. Before believing a test,
   mutate the thing the task exists to prevent and check that **this** test is what goes red — if
   a different one catches it, the one you wrote is describing something else, and both may be
   worth keeping for different reasons.
6. **A test whose name has quietly become false is a defect even while it passes.** One here was
   called "the sign-in rail has two phases, not the sign-up rail's four" after the sign-up rail had
   three. The assertion held; the sentence did not. Rename it rather than leaving a reader to
   trust it.

---

## File structure

| File                                                                | Responsibility                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/web/src/server/hosts.ts`                                      | hostname → which product, as a pure function                                    |
| `apps/web/src/middleware.ts`                                        | apply that decision to a request                                                |
| `packages/core/src/features/identity/domain/wallet-auth.ts`         | address normalisation, CAIP-2, the errors                                       |
| `packages/core/src/features/identity/ports/wallet-identity.ts`      | `NonceStore`, `WalletLinkRepository`, `SignatureVerifier`, `AccountProvisioner` |
| `packages/core/src/features/identity/application/wallet-sign-in.ts` | the ceremony: issue, verify, link                                               |
| `packages/infrastructure/src/persistence/product/identity.ts`       | add the `siweNonces` table                                                      |
| `packages/infrastructure/src/persistence/wallet-identity-store.ts`  | Postgres `NonceStore` + `WalletLinkRepository`                                  |
| `packages/infrastructure/src/chain/siwe.ts`                         | viem message build and signature check                                          |
| `packages/infrastructure/src/supabase/wallet-accounts.ts`           | find-or-create the user, mint a session                                         |
| `workers/api/src/routes/wallet-auth.ts`                             | three HTTP routes                                                               |
| `apps/web/src/features/wallet/lib/connect.ts`                       | browser side of the ceremony                                                    |

---

## Task 1: Find out what Mera costs

**Files:** `docs/specs/user-profiles-and-products-v1.md` (append a finding)

The specification says this is the first task, and it is the only one whose answer could change the
plan. Mera is new: there is no published wagmi connector and no ecosystem documentation. Do not
build a screen on top of it before knowing what connecting to it involves.

- [ ] **Step 1: Read Mera's integration surface**

Read `https://docs.monad.xyz/tooling-and-infra/wallet-infra/embedded-wallets` and Mera's own
documentation. Answer exactly three questions:

1. Does it expose an EIP-1193 provider, or does it require its own SDK calls?
2. Can it produce a `personal_sign` signature over an arbitrary string? (The ceremony needs one.)
3. Does it work in a desktop browser, or only in the native app?

- [ ] **Step 2: Write the answer into the spec**

Append to §13 of `docs/specs/user-profiles-and-products-v1.md` a subsection **"What Mera turned out
to need"** with the three answers and their sources. If it exposes EIP-1193, say that Task 12 gains
a connector and nothing else changes. If it does not, say so plainly — the rest of this plan still
stands, because every task below works with any wallet that can sign a string, and Mera becomes a
second connector rather than a precondition.

- [ ] **Step 3: Commit**

```bash
git commit -m "Record what integrating Mera actually requires" -- docs/specs/user-profiles-and-products-v1.md
```

---

## Task 2: Which product a hostname belongs to

**Files:**

- Create: `apps/web/src/server/hosts.ts`
- Test: `apps/web/test/hosts.test.ts`

A pure function, so both products can be tested without a browser and without the environment the
test happens to run in deciding the answer. `previewAllowed` and `sectionFromSearch` are the shape;
each was written this way after a gate tested in one position turned out to be a gate tested once.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/hosts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { productFor } from "../src/server/hosts";

const HOSTS = { marketplace: "pickler.fun", studio: "app.pickler.fun" };

test("each configured hostname maps to its own product", () => {
  assert.equal(productFor("pickler.fun", HOSTS), "marketplace");
  assert.equal(productFor("app.pickler.fun", HOSTS), "studio");
});

test("a port is not part of the hostname", () => {
  assert.equal(productFor("pickler.fun:443", HOSTS), "marketplace");
  assert.equal(productFor("app.pickler.fun:3001", HOSTS), "studio");
});

test("the comparison ignores case, because a Host header may carry any", () => {
  assert.equal(productFor("APP.Pickler.Fun", HOSTS), "studio");
});

test("localhost belongs to neither, so development serves everything", () => {
  assert.equal(productFor("localhost:3001", HOSTS), "either");
  assert.equal(productFor("127.0.0.1:3001", HOSTS), "either");
});

test("an unknown host is 'either' rather than a guess", () => {
  // A preview deployment on workers.dev must not lose half the application.
  assert.equal(productFor("pickler-web-staging.workers.dev", HOSTS), "either");
});

test("a host that merely ends with the marketplace name is not the marketplace", () => {
  // The check is equality, not suffix: evilpickler.fun must not be served as the product.
  assert.equal(productFor("evilpickler.fun", HOSTS), "either");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test apps/web/test/hosts.test.ts`
Expected: FAIL, `Cannot find module '../src/server/hosts.js'`.

- [ ] **Step 3: Write the function**

```ts
// apps/web/src/server/hosts.ts

/** Which of the two products a request belongs to, or neither. */
export type Product = "marketplace" | "studio" | "either";

export interface ProductHosts {
  marketplace: string;
  studio: string;
}

/**
 * `either` is the honest answer for any host that is not one of the two configured ones —
 * localhost, a preview deployment, an IP. Serving everything there is right: the alternative is a
 * preview build that silently loses half the application, which looks exactly like a broken build.
 *
 * The comparison is equality on the hostname with the port removed, never a suffix match:
 * `evilpickler.fun` ends with `pickler.fun` and is not this product.
 */
export function productFor(host: string | null | undefined, hosts: ProductHosts): Product {
  if (!host) {
    return "either";
  }
  const hostname = host.split(":")[0]!.toLowerCase();
  if (hostname === hosts.marketplace.toLowerCase()) {
    return "marketplace";
  }
  if (hostname === hosts.studio.toLowerCase()) {
    return "studio";
  }
  return "either";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test apps/web/test/hosts.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the suffix test can fail**

Do **not** simply change the marketplace comparison to `endsWith`. `app.pickler.fun` also ends with
`pickler.fun`, so with the marketplace branch checked first that mutation swallows the studio host
as well and four tests go red. The collateral is real but it muddies the proof: it does not show
the `evilpickler.fun` test is load-bearing, because three other tests were already objecting.

Use the isolated mutation instead — check the **studio** first by equality, and the marketplace by
`endsWith`:

```ts
if (hostname === hosts.studio.toLowerCase()) return "studio";
if (hostname.endsWith(hosts.marketplace.toLowerCase())) return "marketplace";
```

Expected: **exactly one** test red, "a host that merely ends with the marketplace name is not the
marketplace". That ordering is a plausible thing a future edit arrives at, it serves
`evilpickler.fun` as the product, and that single test is the only thing in the suite standing
between it and green.

Revert and re-run: 6 passing. Confirm by reading the file that it holds two `===` comparisons and
no `endsWith`.

- [ ] **Step 6: Commit**

```bash
git commit -m "Say which product a hostname belongs to" -- apps/web/src/server/hosts.ts apps/web/test/hosts.test.ts
```

---

## Task 3: Which paths each product owns

**Files:**

- Modify: `apps/web/src/server/hosts.ts`
- Test: `apps/web/test/hosts.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/hosts.test.ts`:

```ts
import { ownerOf } from "../src/server/hosts";

test("studio paths belong to the studio", () => {
  assert.equal(ownerOf("/console"), "studio");
  assert.equal(ownerOf("/account"), "studio");
  assert.equal(ownerOf("/signin"), "studio");
  assert.equal(ownerOf("/signup"), "studio");
  assert.equal(ownerOf("/apply"), "studio");
  assert.equal(ownerOf("/auth/callback"), "studio");
});

test("marketplace paths belong to the marketplace", () => {
  assert.equal(ownerOf("/"), "marketplace");
  assert.equal(ownerOf("/leaderboard"), "marketplace");
  assert.equal(ownerOf("/markets/BTC-PERP"), "marketplace");
  assert.equal(ownerOf("/portfolio"), "marketplace");
  assert.equal(ownerOf("/activity"), "marketplace");
});

test("a nested path belongs where its first segment does", () => {
  assert.equal(ownerOf("/console?section=picks"), "studio");
  assert.equal(ownerOf("/tokens/HALF/picks/9"), "marketplace");
});

test("a path that merely starts with a studio name is not the studio", () => {
  // /accounts-of-agents is a marketplace page that must not be refused on the marketplace.
  assert.equal(ownerOf("/accounts-of-agents"), "marketplace");
});

test("the API and Next's own assets belong to both", () => {
  assert.equal(ownerOf("/api/v1/landing"), "either");
  assert.equal(ownerOf("/_next/static/chunk.js"), "either");
  assert.equal(ownerOf("/favicon.ico"), "either");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test apps/web/test/hosts.test.ts`
Expected: FAIL, `ownerOf is not a function`.

- [ ] **Step 3: Write it**

Append to `apps/web/src/server/hosts.ts`:

```ts
/** First path segments the studio owns. Everything else that is not shared is the marketplace. */
const STUDIO_SEGMENTS = new Set(["console", "account", "signin", "signup", "apply", "auth"]);

/** Shared by both hosts: the API proxy, Next's assets, and files served from the root. */
const SHARED_SEGMENTS = new Set(["api", "_next", "favicon.ico", "robots.txt", "sitemap.xml"]);

/**
 * Matching is on the whole first segment, never a prefix of the path: `/accounts-of-agents`
 * starts with `/account` and is not the account screen.
 */
export function ownerOf(pathname: string): Product {
  const segment = pathname.split("?")[0]!.split("/")[1] ?? "";
  if (SHARED_SEGMENTS.has(segment)) {
    return "either";
  }
  return STUDIO_SEGMENTS.has(segment) ? "studio" : "marketplace";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test apps/web/test/hosts.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the prefix test can fail**

Replace the segment comparison with
`[...STUDIO_SEGMENTS].some((s) => pathname.startsWith("/" + s))`. Re-run.
Expected: exactly one test red — "a path that merely starts with a studio name". Revert; 11 pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "Say which paths each product owns" -- apps/web/src/server/hosts.ts apps/web/test/hosts.test.ts
```

---

## Task 4: The middleware

**Files:**

- Create: `apps/web/src/middleware.ts`
- Test: `apps/web/test/middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/middleware.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/middleware";

const HOSTS = { marketplace: "pickler.fun", studio: "app.pickler.fun" };

test("a path on its own host is served", () => {
  assert.deepEqual(decide("pickler.fun", "/leaderboard", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/console", HOSTS), { kind: "serve" });
});

test("the studio root serves the studio", () => {
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS), { kind: "rewrite", to: "/console" });
});

test("a studio path asked of the marketplace redirects, so old links survive", () => {
  assert.deepEqual(decide("pickler.fun", "/account", HOSTS), {
    kind: "redirect",
    to: "https://app.pickler.fun/account",
  });
});

test("a marketplace path asked of the studio is 404, not a redirect", () => {
  // A redirect would give every screen two canonical URLs.
  assert.deepEqual(decide("app.pickler.fun", "/leaderboard", HOSTS), { kind: "notFound" });
});

test("shared paths are served on both hosts", () => {
  assert.deepEqual(decide("app.pickler.fun", "/api/v1/landing", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("pickler.fun", "/api/v1/landing", HOSTS), { kind: "serve" });
});

test("development is inert: every path is served on localhost", () => {
  assert.deepEqual(decide("localhost:3001", "/console", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/leaderboard", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/", HOSTS), { kind: "serve" });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test apps/web/test/middleware.test.ts`
Expected: FAIL, cannot find `../src/middleware.js`.

- [ ] **Step 3: Write it**

```ts
// apps/web/src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { ownerOf, productFor, type ProductHosts } from "./server/hosts";

export type Decision =
  | { kind: "serve" }
  | { kind: "notFound" }
  | { kind: "rewrite"; to: string }
  | { kind: "redirect"; to: string };

/**
 * Pure, so both products are testable in both positions without a browser.
 *
 * A studio path asked of the marketplace redirects, because links and bookmarks to /console and
 * /account predate the split. A marketplace path asked of the studio is 404: redirecting would
 * give every marketplace screen a second URL on a host it does not belong to, which is worse for
 * search and for anyone reading a link.
 */
export function decide(host: string | null, pathname: string, hosts: ProductHosts): Decision {
  const product = productFor(host, hosts);
  if (product === "either") {
    return { kind: "serve" };
  }
  // Hoisted above the ownership check on purpose. `ownerOf("/")` is `marketplace` — correctly, the
  // landing lives there — so on the studio host the root fails `owner === product` and would fall
  // through to notFound. That would 404 the studio's homepage for every visitor, and the rewrite
  // below would be unreachable for the one path it exists to serve.
  if (product === "studio" && pathname === "/") {
    return { kind: "rewrite", to: "/console" };
  }
  const owner = ownerOf(pathname);
  if (owner === "either" || owner === product) {
    return { kind: "serve" };
  }
  return owner === "studio"
    ? { kind: "redirect", to: `https://${hosts.studio}${pathname}` }
    : { kind: "notFound" };
}

const hosts: ProductHosts = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_HOST ?? "pickler.fun",
  studio: process.env.NEXT_PUBLIC_STUDIO_HOST ?? "app.pickler.fun",
};

export function middleware(request: NextRequest) {
  const decision = decide(request.headers.get("host"), request.nextUrl.pathname, hosts);
  switch (decision.kind) {
    case "serve":
      return NextResponse.next();
    case "notFound":
      return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
    case "rewrite":
      return NextResponse.rewrite(new URL(decision.to, request.url));
    case "redirect":
      return NextResponse.redirect(decision.to, 308);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test apps/web/test/middleware.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the 404 rule can fail**

Change the last line of `decide` so a marketplace path on the studio redirects instead. Re-run.
Expected: exactly one test red — "a marketplace path asked of the studio is 404". Revert; 6 pass.

- [ ] **Step 6: Request the routes**

With `npm run dev` running, confirm nothing broke locally, because a middleware error takes every
route down and typecheck cannot see it:

```bash
for r in / /console /account /leaderboard /portfolio; do
  printf "%-14s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001$r)"
done
```

Expected: all 200.

- [ ] **Step 7: Commit**

```bash
git commit -m "Split the two products by host" -- apps/web/src/middleware.ts apps/web/test/middleware.test.ts
```

---

## Task 5: Somewhere to keep a nonce

**Files:**

- Modify: `packages/infrastructure/src/persistence/product/identity.ts`
- Create: a generated migration under `packages/infrastructure/drizzle/`

- [ ] **Step 1: Add the table**

Append to `packages/infrastructure/src/persistence/product/identity.ts`, after `walletLinks`:

```ts
/**
 * Single-use, five-minute TTL, consumed with DELETE ... RETURNING — the same shape and the same
 * reasoning as wallets.webauthn_challenges, because Workers has no Redis and KV cannot promise a
 * single consumer.
 *
 * It carries no address. The nonce is issued before anyone knows which wallet will answer, and
 * binding it to an address the client claims would bind it to something unverified.
 */
export const siweNonces = identity
  .table(
    "siwe_nonces",
    {
      nonce: text("nonce").primaryKey(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (t) => [index("siwe_nonces_expiry_idx").on(t.expiresAt)],
  )
  .enableRLS();
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/infrastructure && npx drizzle-kit generate
```

Expected: a new `drizzle/NNNN_*.sql` containing `CREATE TABLE "identity"."siwe_nonces"`.

**If the file is empty, stop.** `identity` is in `schemaFilter` in `drizzle.config.ts`, so an empty
migration means the table was not picked up, not that there was nothing to do.

- [ ] **Step 3: Read the generated SQL**

Confirm it creates the table, the primary key and the index, and touches nothing else. A migration
that also drops or alters another table means the local database is out of step with the
migrations; do not commit it.

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck
git commit -m "Give a wallet sign-in somewhere to keep its nonce" -- packages/infrastructure/src/persistence/product/identity.ts packages/infrastructure/drizzle
```

---

## Task 6: The rules, with no database and no viem

**Files:**

- Create: `packages/core/src/features/identity/domain/wallet-auth.ts`
- Test: `packages/core/test/wallet-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/wallet-auth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAddress, caip2, InvalidAddressError } from "../src/index.js";

test("an EVM address is stored lower-case, so two spellings are one link", () => {
  assert.equal(
    normalizeAddress("eip155", "0xAbC0000000000000000000000000000000000001"),
    "0xabc0000000000000000000000000000000000001",
  );
});

test("an address that is not twenty bytes is refused", () => {
  assert.throws(() => normalizeAddress("eip155", "0xabc"), InvalidAddressError);
  assert.throws(() => normalizeAddress("eip155", "not-an-address"), InvalidAddressError);
});

test("a Solana address keeps its case, because base58 is case-significant", () => {
  const address = "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK";
  assert.equal(normalizeAddress("solana", address), address);
});

test("the chain reference is CAIP-2 and names its own family", () => {
  assert.equal(caip2("eip155", 10143), "eip155:10143");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test packages/core/test/wallet-auth.test.ts`
Expected: FAIL, `normalizeAddress` is not exported.

- [ ] **Step 3: Write it**

```ts
// packages/core/src/features/identity/domain/wallet-auth.ts

export type Namespace = "eip155" | "solana";

export class InvalidAddressError extends Error {
  constructor(readonly address: string) {
    super("That does not look like an address for this chain");
    this.name = "InvalidAddressError";
  }
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * EVM addresses are lower-cased so that the checksummed and un-checksummed spellings of one
 * address are one row rather than two. Base58 is case-significant, so a Solana address is left
 * exactly as it was given.
 */
export function normalizeAddress(namespace: Namespace, address: string): string {
  if (namespace === "eip155") {
    if (!EVM.test(address)) {
      throw new InvalidAddressError(address);
    }
    return address.toLowerCase();
  }
  if (!SOLANA.test(address)) {
    throw new InvalidAddressError(address);
  }
  return address;
}

/** CAIP-2, which `wallet_links` checks against its own namespace column. */
export function caip2(namespace: Namespace, reference: number | string): string {
  return `${namespace}:${reference}`;
}
```

Export from `packages/core/src/index.ts`:

```ts
export * from "./features/identity/domain/wallet-auth.js";
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test packages/core/test/wallet-auth.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the case test can fail**

Return `address` unchanged for `eip155`. Re-run.
Expected: exactly one test red — "an EVM address is stored lower-case". Revert; 4 pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "Say what an address is before anything stores one" -- packages/core/src/features/identity/domain/wallet-auth.ts packages/core/src/index.ts packages/core/test/wallet-auth.test.ts
```

---

## Task 7: The ports

**Files:**

- Create: `packages/core/src/features/identity/ports/wallet-identity.ts`
- Modify: `packages/core/src/index.ts`

No test: these are types. They are a separate task so the next one has something to compile against.

- [ ] **Step 1: Write the ports**

```ts
// packages/core/src/features/identity/ports/wallet-identity.ts
import type { Namespace } from "../domain/wallet-auth.js";

export interface WalletLink {
  userId: string;
  namespace: Namespace;
  address: string;
  verifiedChain: string;
  kind: "external" | "mera";
  verifiedAt: Date;
}

export interface NonceStore {
  /** Stores a fresh nonce with its expiry. */
  issue(nonce: string, expiresAt: Date): Promise<void>;
  /**
   * Single-use. Returns the row and deletes it in one statement, so two concurrent verifications
   * of the same nonce cannot both succeed. Returns null when it never existed or was already
   * taken — the two are indistinguishable on purpose: both mean "ask for a new one".
   */
  consume(nonce: string): Promise<{ expiresAt: Date } | null>;
}

export interface WalletLinkRepository {
  findByAddress(namespace: Namespace, address: string): Promise<WalletLink | null>;
  /** `created: false` means the unique index already held this address for another account. */
  link(link: Omit<WalletLink, "verifiedAt">): Promise<{ created: boolean }>;
  /** Errors propagate: "no wallets" and "could not read" are different facts. */
  listForUser(userId: string): Promise<WalletLink[]>;
}

export interface SignatureVerifier {
  /** True only when `signature` was produced by `address` over exactly `message`. */
  verify(input: { message: string; signature: string; address: string }): Promise<boolean>;
}

export interface AccountProvisioner {
  /** The Supabase user for this address, created on first sight. */
  forAddress(namespace: Namespace, address: string): Promise<{ userId: string }>;
  /** A session for an existing user, minted server-side. */
  session(userId: string): Promise<{ accessToken: string; refreshToken: string }>;
}
```

Export from `packages/core/src/index.ts`:

```ts
export type {
  AccountProvisioner,
  NonceStore,
  SignatureVerifier,
  WalletLink,
  WalletLinkRepository,
} from "./features/identity/ports/wallet-identity.js";
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git commit -m "Name what a wallet sign-in needs from the world" -- packages/core/src/features/identity/ports/wallet-identity.ts packages/core/src/index.ts
```

---

## Task 8: The ceremony

**Files:**

- Create: `packages/core/src/features/identity/application/wallet-sign-in.ts`
- Test: `packages/core/test/wallet-sign-in.test.ts`

This is where the rules that matter live. Every one of them gets a test that is proved to fail.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/wallet-sign-in.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWalletSignIn,
  ExpiredNonceError,
  UnknownNonceError,
  WrongDomainError,
  BadSignatureError,
  AddressTakenError,
  type NonceStore,
  type WalletLink,
  type WalletLinkRepository,
} from "../src/index.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const DOMAIN = "pickler.fun";
const ADDRESS = "0xabc0000000000000000000000000000000000001";

function nonces(rows = new Map<string, Date>()): NonceStore & { rows: Map<string, Date> } {
  return {
    rows,
    issue: async (nonce, expiresAt) => void rows.set(nonce, expiresAt),
    consume: async (nonce) => {
      const expiresAt = rows.get(nonce);
      if (!expiresAt) return null;
      rows.delete(nonce); // one statement in Postgres; one operation here
      return { expiresAt };
    },
  };
}

function links(rows: WalletLink[] = []): WalletLinkRepository & { rows: WalletLink[] } {
  return {
    rows,
    findByAddress: async (ns, a) => rows.find((r) => r.namespace === ns && r.address === a) ?? null,
    link: async (l) => {
      if (rows.some((r) => r.namespace === l.namespace && r.address === l.address)) {
        return { created: false };
      }
      rows.push({ ...l, verifiedAt: NOW });
      return { created: true };
    },
    listForUser: async (userId) => rows.filter((r) => r.userId === userId),
  };
}

/**
 * The fakes round-trip a string, because that is what the real pair does: infrastructure builds a
 * SIWE message and parses it back. A fake that passed an object straight through would not be
 * exercising the thing the service actually depends on.
 */
const build = (f: { domain: string; address: string; chainReference: number; nonce: string }) =>
  `${f.domain}|${f.address}|${f.chainReference}|${f.nonce}`;

const parse = (raw: string) => {
  const [domain, address, chainReference, nonce] = raw.split("|");
  return {
    domain: domain!,
    address: address!,
    namespace: "eip155" as const,
    chainReference: Number(chainReference),
    nonce: nonce!,
    statement: "Sign in to Pickler",
    issuedAt: NOW.toISOString(),
  };
};

function service(over: Partial<Parameters<typeof createWalletSignIn>[0]> = {}) {
  return createWalletSignIn({
    clock: { now: () => NOW },
    domain: DOMAIN,
    nonces: nonces(),
    links: links(),
    verifier: { verify: async () => true },
    accounts: {
      forAddress: async () => ({ userId: "user-1" }),
      session: async () => ({ accessToken: "at", refreshToken: "rt" }),
    },
    randomNonce: () => "nonce-1",
    buildMessage: build,
    parseMessage: parse,
    ...over,
  });
}

/** A string of the shape the service hands out, with one field overridable per test. */
const signed = (over: { domain?: string; nonce?: string; address?: string } = {}) =>
  build({
    domain: over.domain ?? DOMAIN,
    address: over.address ?? ADDRESS,
    chainReference: 10143,
    nonce: over.nonce ?? "nonce-1",
  });

test("a nonce is issued with a five-minute expiry, and the string to sign comes with it", async () => {
  const store = nonces();
  const signIn = service({ nonces: store });
  const { nonce, message } = await signIn.issueNonce({
    address: ADDRESS,
    namespace: "eip155",
    chainReference: 10143,
  });
  assert.equal(nonce, "nonce-1");
  assert.deepEqual(store.rows.get("nonce-1"), new Date("2026-09-23T12:05:00Z"));
  // The browser signs this and sends it back; it never builds one of its own.
  assert.equal(message, `${DOMAIN}|${ADDRESS}|10143|nonce-1`);
});

test("the address in the message is normalised, so one wallet is one link", async () => {
  const signIn = service();
  const { message } = await signIn.issueNonce({
    address: ADDRESS.toUpperCase().replace("0X", "0x"),
    namespace: "eip155",
    chainReference: 10143,
  });
  assert.ok(message.includes(ADDRESS));
});

test("a good signature returns a session", async () => {
  const signIn = service();
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-1");
  assert.equal(result.session.accessToken, "at");
});

test("the same nonce cannot be spent twice", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store });
  await signIn.verify({ raw: signed(), signature: "0xsig" });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    UnknownNonceError,
  );
});

test("an expired nonce is refused even though it exists", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T11:59:59Z")]]));
  const signIn = service({ nonces: store });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    ExpiredNonceError,
  );
});

test("a signature for another domain is refused", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store });
  await assert.rejects(
    () => signIn.verify({ raw: signed({ domain: "evil.example" }), signature: "0xsig" }),
    WrongDomainError,
  );
});

test("a signature that does not belong to the address is refused", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store, verifier: { verify: async () => false } });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    BadSignatureError,
  );
});

test("signing in with an already-linked address returns that account, not a new one", async () => {
  const existing: WalletLink = {
    userId: "user-original",
    namespace: "eip155",
    address: ADDRESS,
    verifiedChain: "eip155:10143",
    kind: "external",
    verifiedAt: NOW,
  };
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({
    nonces: store,
    links: links([existing]),
    // forAddress must not be consulted; if it is, the test's assertion on userId catches it.
    accounts: {
      forAddress: async () => ({ userId: "user-newly-made" }),
      session: async (userId) => ({ accessToken: `at:${userId}`, refreshToken: "rt" }),
    },
  });
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-original");
});

test("linking an address owned by another account fails rather than moving it", async () => {
  const existing: WalletLink = {
    userId: "user-other",
    namespace: "eip155",
    address: ADDRESS,
    verifiedChain: "eip155:10143",
    kind: "external",
    verifiedAt: NOW,
  };
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store, links: links([existing]) });
  await assert.rejects(
    () => signIn.link("user-1", { raw: signed(), signature: "0xsig" }),
    AddressTakenError,
  );
});

test("a failed read of someone's links propagates rather than reading as none", async () => {
  const broken = links();
  broken.listForUser = async () => {
    throw new Error("connection reset");
  };
  const signIn = service({ links: broken });
  await assert.rejects(() => signIn.listLinks("user-1"), /connection reset/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test packages/core/test/wallet-sign-in.test.ts`
Expected: FAIL, `createWalletSignIn` is not exported.

- [ ] **Step 3: Write it**

```ts
// packages/core/src/features/identity/application/wallet-sign-in.ts
import type { Clock } from "../../../ports/clock.js";
import { normalizeAddress, caip2, type Namespace } from "../domain/wallet-auth.js";
import type {
  AccountProvisioner,
  NonceStore,
  SignatureVerifier,
  WalletLink,
  WalletLinkRepository,
} from "../ports/wallet-identity.js";

export class UnknownNonceError extends Error {
  constructor() {
    super("That sign-in request is no longer valid. Ask for a new one.");
    this.name = "UnknownNonceError";
  }
}
export class ExpiredNonceError extends Error {
  constructor() {
    super("That sign-in request has expired. Ask for a new one.");
    this.name = "ExpiredNonceError";
  }
}
export class WrongDomainError extends Error {
  constructor() {
    super("That signature was made for another site");
    this.name = "WrongDomainError";
  }
}
export class BadSignatureError extends Error {
  constructor() {
    super("That signature does not belong to that address");
    this.name = "BadSignatureError";
  }
}
export class AddressTakenError extends Error {
  constructor() {
    super("That wallet is already linked to another Pickler account");
    this.name = "AddressTakenError";
  }
}

/** Five minutes, the same window a WebAuthn challenge gets. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

export interface SignedMessage {
  domain: string;
  nonce: string;
  address: string;
  namespace: Namespace;
  chainReference: number | string;
  statement: string;
  issuedAt: string;
}

export interface Presented {
  /** The exact string that was signed — the one this service handed out. Nothing else is trusted. */
  raw: string;
  signature: string;
}

export interface WalletSignInDependencies {
  clock: Clock;
  domain: string;
  nonces: NonceStore;
  links: WalletLinkRepository;
  verifier: SignatureVerifier;
  accounts: AccountProvisioner;
  randomNonce: () => string;
  /** Builds the string to sign. Lives in infrastructure because it is viem's format. */
  buildMessage: (fields: MessageFields) => string;
  /** Reads back the fields from a string this service built. Throws if it is not one. */
  parseMessage: (raw: string) => SignedMessage;
}

export interface MessageFields {
  domain: string;
  address: string;
  chainReference: number;
  nonce: string;
  issuedAt: Date;
}

export function createWalletSignIn(deps: WalletSignInDependencies) {
  /**
   * Everything that must hold before an address is believed, in the order that spends the least:
   * the nonce is taken first because taking it is what makes a replay impossible, and the
   * signature is checked last because it is the expensive one.
   */
  async function proven(presented: Presented) {
    const parsed = deps.parseMessage(presented.raw);
    const taken = await deps.nonces.consume(parsed.nonce);
    if (!taken) {
      throw new UnknownNonceError();
    }
    if (taken.expiresAt.getTime() <= deps.clock.now().getTime()) {
      throw new ExpiredNonceError();
    }
    if (parsed.domain !== deps.domain) {
      throw new WrongDomainError();
    }
    const address = normalizeAddress(parsed.namespace, parsed.address);
    const ok = await deps.verifier.verify({
      message: presented.raw,
      signature: presented.signature,
      address,
    });
    if (!ok) {
      throw new BadSignatureError();
    }
    return { address, namespace: parsed.namespace, chainReference: parsed.chainReference };
  }

  return {
    /**
     * Returns the exact string to sign, not just a nonce. The browser signs what it is given and
     * sends it back verbatim, so there is only ever one builder. Two builders — one here, one in
     * the browser — that disagree by a single byte produce a signature that fails verification
     * with no indication of why, and the failure looks exactly like the wrong wallet.
     *
     * The address is unverified at this point and that is fine: it goes into the message, and the
     * signature is what proves it.
     */
    async issueNonce(input: { address: string; namespace: Namespace; chainReference: number }) {
      const nonce = deps.randomNonce();
      await deps.nonces.issue(nonce, new Date(deps.clock.now().getTime() + NONCE_TTL_MS));
      const message = deps.buildMessage({
        domain: deps.domain,
        address: normalizeAddress(input.namespace, input.address),
        chainReference: input.chainReference,
        nonce,
        issuedAt: deps.clock.now(),
      });
      return { nonce, message };
    },

    /** Sign in: an address already linked returns its account; a new one gets an account made. */
    async verify(presented: Presented) {
      const { address, namespace, chainReference } = await proven(presented);
      const existing = await deps.links.findByAddress(namespace, address);
      if (existing) {
        return { userId: existing.userId, session: await deps.accounts.session(existing.userId) };
      }
      const { userId } = await deps.accounts.forAddress(namespace, address);
      await deps.links.link({
        userId,
        namespace,
        address,
        verifiedChain: caip2(namespace, chainReference),
        kind: "external",
      });
      return { userId, session: await deps.accounts.session(userId) };
    },

    /** Link to the signed-in account. An address owned elsewhere is refused, never moved. */
    async link(userId: string, presented: Presented) {
      const { address, namespace, chainReference } = await proven(presented);
      const existing = await deps.links.findByAddress(namespace, address);
      if (existing && existing.userId !== userId) {
        throw new AddressTakenError();
      }
      const { created } = await deps.links.link({
        userId,
        namespace,
        address,
        verifiedChain: caip2(namespace, chainReference),
        kind: "external",
      });
      if (!created && !existing) {
        throw new AddressTakenError();
      }
      return { linked: true as const };
    },

    /** No catch: a failed read must not render as an account with no wallets. */
    listLinks(userId: string): Promise<WalletLink[]> {
      return deps.links.listForUser(userId);
    },
  };
}
```

Export from `packages/core/src/index.ts`:

```ts
export {
  AddressTakenError,
  BadSignatureError,
  createWalletSignIn,
  ExpiredNonceError,
  NONCE_TTL_MS,
  UnknownNonceError,
  WrongDomainError,
  type Presented,
  type SignedMessage,
} from "./features/identity/application/wallet-sign-in.js";
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test packages/core/test/wallet-sign-in.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Prove three of the pins can fail, one at a time**

Each of these is a rule someone could plausibly "simplify" away. Make the change, re-run, confirm
**exactly one** test goes red, revert.

**The ordering mutation is not caught by the spend-twice test, and cannot be.** Spending a nonce
twice _in sequence_ behaves identically under both orderings — the first call consumes it, the
second finds nothing, wherever the consume sits. The window the order closes is a **concurrent**
one, and a sequential test has no concurrency to observe.

What distinguishes them is a _failed_ attempt. Consume-first burns the nonce on a bad signature;
verify-first leaves it sitting there, so a harvested message can be retried against the same nonce
until a signature lands. That is the actual security property, and it **is** observable in sequence:

```ts
test("a bad signature still spends the nonce, so it cannot be retried", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store, verifier: { verify: async () => false } });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    BadSignatureError,
  );
  assert.equal(store.rows.has("nonce-1"), false);
});
```

Keep the spend-twice test as well: it pins single-use, which is a different rule.

| Break                                                       | Only this test should fail                    |
| ----------------------------------------------------------- | --------------------------------------------- |
| Move the `consume` call to after the signature check        | "a bad signature still spends the nonce"      |
| Delete the `presented.message.domain !== deps.domain` check | "a signature for another domain is refused"   |
| In `verify`, always call `deps.accounts.forAddress`         | "signing in with an already-linked address…"  |
| Wrap `listLinks` in `try { … } catch { return [] }`         | "a failed read of someone's links propagates" |

- [ ] **Step 6: Commit**

```bash
git commit -m "Prove an address before believing it, and never move one between accounts" -- packages/core/src/features/identity/application/wallet-sign-in.ts packages/core/src/index.ts packages/core/test/wallet-sign-in.test.ts
```

---

## Task 9: The Postgres store

**Files:**

- Create: `packages/infrastructure/src/persistence/wallet-identity-store.ts`
- Test: `packages/infrastructure/test/wallet-identity-store.test.ts`
- Modify: `packages/infrastructure/src/index.ts`

- [ ] **Step 1: Write it**

```ts
// packages/infrastructure/src/persistence/wallet-identity-store.ts
import type { Pool } from "pg";
import type { Namespace, NonceStore, WalletLink, WalletLinkRepository } from "@pickler/core";

export class PostgresWalletIdentityStore implements NonceStore, WalletLinkRepository {
  constructor(private readonly pool: Pool) {}

  async issue(nonce: string, expiresAt: Date): Promise<void> {
    await this.pool.query(`INSERT INTO identity.siwe_nonces (nonce, expires_at) VALUES ($1, $2)`, [
      nonce,
      expiresAt,
    ]);
  }

  /** One statement, so two concurrent verifications cannot both receive the same nonce. */
  async consume(nonce: string): Promise<{ expiresAt: Date } | null> {
    const { rows } = await this.pool.query<{ expiresAt: Date }>(
      `DELETE FROM identity.siwe_nonces
        WHERE nonce = $1
        RETURNING expires_at AS "expiresAt"`,
      [nonce],
    );
    return rows[0] ?? null;
  }

  async findByAddress(namespace: Namespace, address: string): Promise<WalletLink | null> {
    const { rows } = await this.pool.query<WalletLink>(
      `SELECT user_id AS "userId", namespace, address,
              verified_chain AS "verifiedChain", kind, verified_at AS "verifiedAt"
         FROM identity.wallet_links
        WHERE namespace = $1 AND address = $2`,
      [namespace, address],
    );
    return rows[0] ?? null;
  }

  /**
   * ON CONFLICT DO NOTHING on the unique (namespace, address) index, so a concurrent link of the
   * same address reports `created: false` rather than raising. The caller decides what that means.
   */
  async link(link: Omit<WalletLink, "verifiedAt">): Promise<{ created: boolean }> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO identity.wallet_links
         (user_id, namespace, verified_chain, address, method, kind, verified_at)
       VALUES ($1, $2, $3, $4, 'siwe', $5, now())
       ON CONFLICT (namespace, address) DO NOTHING`,
      [link.userId, link.namespace, link.verifiedChain, link.address, link.kind],
    );
    return { created: rowCount === 1 };
  }

  /** No catch. A failed read is a failure, never an account with no wallets. */
  async listForUser(userId: string): Promise<WalletLink[]> {
    const { rows } = await this.pool.query<WalletLink>(
      `SELECT user_id AS "userId", namespace, address,
              verified_chain AS "verifiedChain", kind, verified_at AS "verifiedAt"
         FROM identity.wallet_links
        WHERE user_id = $1
        ORDER BY verified_at`,
      [userId],
    );
    return rows;
  }
}
```

Export it from `packages/infrastructure/src/index.ts` beside the other stores.

- [ ] **Step 2: Write the test against a real database**

`packages/infrastructure/test/custody-store.test.ts` is the model: it runs real SQL against
Postgres. Copy its setup and skip guard exactly. The tests to write:

```ts
test("a nonce can be consumed once", async () => {
  await store.issue("n1", new Date(Date.now() + 60_000));
  assert.ok(await store.consume("n1"));
  assert.equal(await store.consume("n1"), null);
});

test("two concurrent consumers, one winner", async () => {
  await store.issue("n2", new Date(Date.now() + 60_000));
  const [a, b] = await Promise.all([store.consume("n2"), store.consume("n2")]);
  assert.equal([a, b].filter(Boolean).length, 1);
});

test("an address belongs to one account", async () => {
  await store.link({
    userId: USER_A,
    namespace: "eip155",
    address: ADDR,
    verifiedChain: "eip155:10143",
    kind: "external",
  });
  const second = await store.link({
    userId: USER_B,
    namespace: "eip155",
    address: ADDR,
    verifiedChain: "eip155:10143",
    kind: "external",
  });
  assert.equal(second.created, false);
  assert.equal((await store.findByAddress("eip155", ADDR))?.userId, USER_A);
});

test("the same string on two chain families is two links", async () => {
  // The unique key is (namespace, address), not address.
  await store.link({
    userId: USER_A,
    namespace: "eip155",
    address: ADDR,
    verifiedChain: "eip155:10143",
    kind: "external",
  });
  const other = await store.link({
    userId: USER_A,
    namespace: "solana",
    address: SOL_ADDR,
    verifiedChain: "solana:mainnet",
    kind: "mera",
  });
  assert.equal(other.created, true);
});

test("listForUser returns only that user's links, oldest first", async () => {
  await store.link({
    userId: USER_A,
    namespace: "eip155",
    address: ADDR,
    verifiedChain: "eip155:10143",
    kind: "external",
  });
  await store.link({
    userId: USER_B,
    namespace: "eip155",
    address: OTHER_ADDR,
    verifiedChain: "eip155:10143",
    kind: "external",
  });
  const mine = await store.listForUser(USER_A);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.address, ADDR);
});
```

- [ ] **Step 3: Prove the scoping test can fail**

Replace `WHERE user_id = $1` in `listForUser` with `WHERE $1 IS NOT NULL`. Re-run.
Expected: the scoping test goes red. Revert.

- [ ] **Step 4: Run, typecheck, commit**

```bash
npm test && npm run typecheck
git commit -m "Read and write the wallet links, one address to one account" -- packages/infrastructure/src/persistence/wallet-identity-store.ts packages/infrastructure/src/index.ts packages/infrastructure/test/wallet-identity-store.test.ts
```

---

## Task 10: The signature, with viem

**Files:**

- Create: `packages/infrastructure/src/chain/siwe.ts`
- Test: `packages/infrastructure/test/siwe.test.ts`
- Modify: `packages/infrastructure/src/index.ts`

`viem` 2.56.8 is already a dependency of `packages/infrastructure`. It stays out of `packages/core`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/infrastructure/test/siwe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { buildSiweMessage, createSignatureVerifier, parseSiweMessage } from "../src/index.js";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const verifier = createSignatureVerifier();

const fields = {
  domain: "pickler.fun",
  address: account.address,
  statement: "Sign in to Pickler",
  uri: "https://pickler.fun",
  chainId: 10143,
  nonce: "nonce-1",
  issuedAt: new Date("2026-09-23T12:00:00Z"),
};

test("a signature over the built message verifies", async () => {
  const raw = buildSiweMessage(fields);
  const signature = await account.signMessage({ message: raw });
  assert.equal(
    await verifier.verify({ message: raw, signature, address: account.address.toLowerCase() }),
    true,
  );
});

test("a signature over a different message does not verify", async () => {
  const signature = await account.signMessage({ message: buildSiweMessage(fields) });
  const tampered = buildSiweMessage({ ...fields, nonce: "nonce-2" });
  assert.equal(
    await verifier.verify({ message: tampered, signature, address: account.address.toLowerCase() }),
    false,
  );
});

test("a signature from another key does not verify", async () => {
  const other = privateKeyToAccount(
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  );
  const raw = buildSiweMessage(fields);
  const signature = await other.signMessage({ message: raw });
  assert.equal(
    await verifier.verify({ message: raw, signature, address: account.address.toLowerCase() }),
    false,
  );
});

test("the built message carries the domain and the nonce, because both are checked", () => {
  const raw = buildSiweMessage(fields);
  assert.match(raw, /^pickler\.fun wants you to sign in/);
  assert.match(raw, /Nonce: nonce-1/);
});

test("what was built can be read back, so one module owns both directions", () => {
  const raw = buildSiweMessage(fields);
  const parsed = parseSiweMessage(raw);
  assert.equal(parsed.domain, "pickler.fun");
  assert.equal(parsed.nonce, "nonce-1");
  assert.equal(parsed.chainReference, 10143);
  assert.equal(parsed.address.toLowerCase(), account.address.toLowerCase());
});

test("a string that is not a sign-in message is refused, not half-read", () => {
  assert.throws(() => parseSiweMessage("hello"), /not a Pickler sign-in message/);
});

test("a malformed signature is false rather than an exception", async () => {
  assert.equal(
    await verifier.verify({ message: "x", signature: "not-a-signature", address: account.address }),
    false,
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test packages/infrastructure/test/siwe.test.ts`
Expected: FAIL, `buildSiweMessage` is not exported.

- [ ] **Step 3: Write it**

```ts
// packages/infrastructure/src/chain/siwe.ts
import { createSiweMessage, parseSiweMessage as parseSiwe, type SiweMessage } from "viem/siwe";
import { verifyMessage } from "viem";
import type { SignatureVerifier, SignedMessage } from "@pickler/core";

export type SiweFields = Pick<
  SiweMessage,
  "domain" | "address" | "statement" | "uri" | "chainId" | "nonce" | "issuedAt"
>;

/** The exact string presented for signature. It is also the string verified, byte for byte. */
export function buildSiweMessage(fields: SiweFields): string {
  return createSiweMessage({ version: "1", ...fields });
}

/**
 * Reads a message this module built. It is the only reader: nothing trusts fields the client sends
 * alongside the string, because the signature covers the string and nothing else.
 */
export function parseSiweMessage(raw: string): SignedMessage {
  const parsed = parseSiwe(raw);
  if (!parsed.domain || !parsed.address || !parsed.nonce || parsed.chainId === undefined) {
    throw new MalformedMessageError();
  }
  return {
    domain: parsed.domain,
    address: parsed.address,
    namespace: "eip155",
    chainReference: parsed.chainId,
    nonce: parsed.nonce,
    statement: parsed.statement ?? "",
    issuedAt: (parsed.issuedAt ?? new Date()).toISOString(),
  };
}

export class MalformedMessageError extends Error {
  constructor() {
    super("That is not a Pickler sign-in message");
    this.name = "MalformedMessageError";
  }
}

/**
 * A malformed signature answers false rather than raising. A caller cannot tell "not signed by
 * that address" from "not a signature at all", and should not: both mean the request is refused.
 */
export function createSignatureVerifier(): SignatureVerifier {
  return {
    async verify({ message, signature, address }) {
      try {
        return await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
      } catch {
        return false;
      }
    },
  };
}
```

Export both from `packages/infrastructure/src/index.ts`.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test packages/infrastructure/test/siwe.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the tamper test can fail**

Make `verify` return `true` unconditionally. Re-run.
Expected: three tests red — the tamper, the wrong key and the malformed one. That is correct: they
are three different ways of catching the same lie. Revert; 5 pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "Check a signature against the message that was actually signed" -- packages/infrastructure/src/chain/siwe.ts packages/infrastructure/src/index.ts packages/infrastructure/test/siwe.test.ts
```

---

## Task 11: The Supabase account behind an address

**Files:**

- Create: `packages/infrastructure/src/supabase/wallet-accounts.ts`
- Test: `packages/infrastructure/test/wallet-accounts.test.ts`
- Modify: `packages/infrastructure/src/index.ts`

- [ ] **Step 1: Write it**

```ts
// packages/infrastructure/src/supabase/wallet-accounts.ts
import type { AccountProvisioner, Namespace } from "@pickler/core";
import type { SupabaseAdmin } from "./supabase-admin-client.js";

/**
 * Supabase Auth wants an email or a phone and a wallet has neither, so the user is created with a
 * synthetic, non-deliverable address derived from the wallet.
 *
 * It is an internal key and never a contact: it is shown on no screen and never sent to. The real
 * email a person gives later is a field on their profile, not a change to this identity — because
 * changing it would mean rewriting the row every other table points at, and because linking a
 * second wallet would otherwise look like changing your email address.
 *
 * The domain must therefore never be made to accept mail.
 */
export function syntheticEmail(namespace: Namespace, address: string, domain: string): string {
  return `${namespace}-${address.toLowerCase()}@${domain}`;
}

export interface WalletAccountsConfig {
  admin: SupabaseAdmin;
  /** e.g. "wallet.pickler.fun". Never deliverable. */
  emailDomain: string;
}

export function createWalletAccounts(config: WalletAccountsConfig): AccountProvisioner {
  return {
    async forAddress(namespace, address) {
      const email = syntheticEmail(namespace, address, config.emailDomain);
      const created = await config.admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { wallet_namespace: namespace, wallet_address: address },
      });
      if (created.data.user) {
        return { userId: created.data.user.id };
      }
      // Already there: the address signed in before. Not an error.
      const { data, error } = await config.admin.auth.admin.listUsers();
      if (error) {
        throw error;
      }
      const found = data.users.find((u) => u.email === email);
      if (!found) {
        throw created.error ?? new Error("Could not create or find the account for that wallet");
      }
      return { userId: found.id };
    },

    async session(userId) {
      const { data: user, error: userError } = await config.admin.auth.admin.getUserById(userId);
      if (userError || !user.user?.email) {
        throw userError ?? new Error("That account has no address to mint a session against");
      }
      // generateLink returns a hashed token; verifyOtp exchanges it for a session, server-side.
      const { data: link, error: linkError } = await config.admin.auth.admin.generateLink({
        type: "magiclink",
        email: user.user.email,
      });
      if (linkError || !link.properties?.hashed_token) {
        throw linkError ?? new Error("Could not mint a session for that account");
      }
      const { data: session, error: otpError } = await config.admin.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: "magiclink",
      });
      if (otpError || !session.session) {
        throw otpError ?? new Error("Could not mint a session for that account");
      }
      return {
        accessToken: session.session.access_token,
        refreshToken: session.session.refresh_token,
      };
    },
  };
}
```

- [ ] **Step 2: Test what can be tested without Supabase**

```ts
test("the synthetic address is derived from the wallet and is not deliverable", () => {
  assert.equal(
    syntheticEmail("eip155", "0xABC0000000000000000000000000000000000001", "wallet.pickler.fun"),
    "eip155-0xabc0000000000000000000000000000000000001@wallet.pickler.fun",
  );
});

test("two spellings of one address give one account", () => {
  const lower = syntheticEmail("eip155", "0xabc0000000000000000000000000000000000001", "d");
  const upper = syntheticEmail("eip155", "0xABC0000000000000000000000000000000000001", "d");
  assert.equal(lower, upper);
});

test("the same address on two chain families gives two accounts", () => {
  assert.notEqual(syntheticEmail("eip155", "0xabc", "d"), syntheticEmail("solana", "0xabc", "d"));
});
```

- [ ] **Step 3: Run, typecheck, commit**

```bash
node --import tsx --test packages/infrastructure/test/wallet-accounts.test.ts
npm run typecheck
git commit -m "Give a wallet an account without pretending it has an email" -- packages/infrastructure/src/supabase/wallet-accounts.ts packages/infrastructure/src/index.ts packages/infrastructure/test/wallet-accounts.test.ts
```

---

## Task 12: The three routes

**Files:**

- Create: `workers/api/src/routes/wallet-auth.ts`
- Modify: `workers/api/src/app.ts`, `workers/api/src/container.ts`, `workers/api/src/env.ts`
- Test: `workers/api/test/wallet-auth.test.ts`

- [ ] **Step 1: Write the routes**

```ts
// workers/api/src/routes/wallet-auth.ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { createWalletSignIn } from "@pickler/core";
import {
  AddressTakenError,
  BadSignatureError,
  ExpiredNonceError,
  UnknownNonceError,
  WrongDomainError,
} from "@pickler/core";
import type { AppEnv } from "../env";
import { successEnvelope } from "../http/envelope";
import { badRequest, HttpError } from "../http/http-error";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface WalletAuthServices {
  authenticate: Authenticate;
  signIn: ReturnType<typeof createWalletSignIn>;
}

/** Every refusal is a 400 or 401 with a code the browser can branch on, never a 500. */
function asHttp(caught: unknown): never {
  if (caught instanceof UnknownNonceError || caught instanceof ExpiredNonceError) {
    throw badRequest(caught.message, { error: "nonce_invalid" });
  }
  if (caught instanceof WrongDomainError) {
    throw badRequest(caught.message, { error: "wrong_domain" });
  }
  if (caught instanceof BadSignatureError) {
    throw new HttpError(401, caught.message);
  }
  if (caught instanceof AddressTakenError) {
    throw new HttpError(409, caught.message);
  }
  throw caught;
}

export function walletAuthRoutes(services: WalletAuthServices) {
  const api = new Hono<AppEnv>();
  api.use("*", bodyLimit({ maxSize: 8_192 }));
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  // Public: there is no session yet, which is the point. Answers with the string to sign.
  api.post("/nonce", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      address?: string;
      chain_id?: number;
    } | null;
    if (!body?.address || typeof body.chain_id !== "number") {
      throw badRequest("An address and a chain id are required to build the message");
    }
    const issued = await services.signIn.issueNonce({
      address: body.address,
      namespace: "eip155",
      chainReference: body.chain_id,
    });
    return c.json(successEnvelope(issued, c.req.path));
  });

  /** `raw` is the whole request: the signature covers that string and nothing else is trusted. */
  function presented(body: unknown) {
    const it = body as { raw?: string; signature?: string } | null;
    if (!it?.raw || !it.signature) {
      throw badRequest("The exact string signed and its signature are both required");
    }
    return { raw: it.raw, signature: it.signature };
  }

  api.post("/verify", async (c) => {
    const result = await services.signIn
      .verify(presented(await c.req.json().catch(() => null)))
      .catch(asHttp);
    return c.json(successEnvelope(result, c.req.path, "Signed in"));
  });

  api.post("/link", authenticated(services.authenticate, { userOnly: true }), async (c) => {
    const result = await services.signIn
      .link(c.get("principal").id, presented(await c.req.json().catch(() => null)))
      .catch(asHttp);
    return c.json(successEnvelope(result, c.req.path, "Wallet linked"));
  });

  api.get("/links", authenticated(services.authenticate, { userOnly: true }), async (c) =>
    c.json(successEnvelope(await services.signIn.listLinks(c.get("principal").id), c.req.path)),
  );

  return api;
}
```

- [ ] **Step 2: Mount it**

In `workers/api/src/app.ts`, beside the other conditional mounts:

```ts
if (services.walletAuth) {
  app.route("/v1/auth/wallet", walletAuthRoutes(services.walletAuth));
}
```

and add `walletAuth?: WalletAuthServices;` to the `Services` interface.

In `workers/api/src/container.ts`, build it from the pool and the Supabase admin client already
there, with `SIWE_DOMAIN` and `WALLET_EMAIL_DOMAIN` added to `workers/api/src/env.ts`. Follow
`custodyServices`: return `undefined` when either variable is missing, so the routes are simply not
mounted rather than mounted and broken.

**The two message shapes do not match, and the adapter belongs here.** Core's `MessageFields` is
`{ domain, address, chainReference, nonce, issuedAt }`; viem's `SiweFields` is
`{ domain, address, statement, uri, chainId, nonce, issuedAt }`. Core deliberately does not know
about `uri` or viem's naming, so the container supplies both:

```ts
// workers/api/src/container.ts
function walletAuthServices(
  env: Env,
  pool: Pool,
  admin: SupabaseAdmin,
  authenticate: Authenticate,
) {
  const domain = env.SIWE_DOMAIN;
  const emailDomain = env.WALLET_EMAIL_DOMAIN;
  if (!domain || !emailDomain) {
    return undefined;
  }
  const store = new PostgresWalletIdentityStore(pool);
  return {
    authenticate,
    signIn: createWalletSignIn({
      clock: { now: () => new Date() },
      domain,
      nonces: store,
      links: store,
      verifier: createSignatureVerifier(),
      accounts: createWalletAccounts({ admin, emailDomain }),
      randomNonce: () => crypto.randomUUID().replace(/-/g, ""),
      buildMessage: (fields) =>
        buildSiweMessage({
          domain: fields.domain,
          address: fields.address as `0x${string}`,
          statement: "Sign in to Pickler",
          uri: `https://${fields.domain}`,
          chainId: fields.chainReference,
          nonce: fields.nonce,
          issuedAt: fields.issuedAt,
        }),
      parseMessage: parseSiweMessage,
    }),
  };
}
```

`randomNonce` uses `crypto.randomUUID()`, which is available on Workers and is a cryptographically
strong source. A counter or a timestamp would be guessable, and a guessable nonce is not a nonce.

- [ ] **Step 3: Write the route tests**

`workers/api/test/signing.test.ts` is the model, including its list of routes feeding "API keys and
anonymous callers never reach custody". Write:

```ts
const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("the nonce route is reachable without a session and returns a string to sign", async () => {
  const app = createApp(services());
  const response = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 10143 });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.ok(data.message.includes(data.nonce));
});

test("the nonce route refuses a body with no address", async () => {
  const app = createApp(services());
  const response = await post(app, "/v1/auth/wallet/nonce", { chain_id: 10143 });
  assert.equal(response.status, 400);
});

test("link refuses an anonymous caller", async () => {
  const app = createApp(services());
  const response = await post(app, "/v1/auth/wallet/link", { raw: "x", signature: "0x" });
  assert.equal(response.status, 401);
});

test("an address linked to another account answers 409, not 500", async () => {
  const app = createApp(services({ link: () => Promise.reject(new AddressTakenError()) }));
  const response = await post(
    app,
    "/v1/auth/wallet/link",
    { raw: RAW, signature: "0xsig" },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(response.status, 409);
});

test("a spent nonce answers 400 with nonce_invalid, so the browser can ask for another", async () => {
  const app = createApp(services({ verify: () => Promise.reject(new UnknownNonceError()) }));
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "nonce_invalid");
});

test("a bad signature answers 401, which is a different thing from a spent nonce", async () => {
  const app = createApp(services({ verify: () => Promise.reject(new BadSignatureError()) }));
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 401);
});
```

`services(over)` builds the app's dependencies with a fake `signIn` whose four methods can each be
overridden, in the shape `workers/api/test/signing.test.ts` already uses for custody.

Before adding `["POST", "/v1/auth/wallet/link"]` to the existing anonymous-caller route list,
confirm that loop builds a fresh harness per route with per-route assertions, so that extending it
adds a case rather than changing what an existing assertion means.

- [ ] **Step 4: Prove the 409 test can fail**

Delete the `AddressTakenError` branch from `asHttp`. Re-run.
Expected: the 409 test goes red with a 500. Revert.

- [ ] **Step 5: Request the route**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/v1/auth/wallet/nonce
```

Expected: 200 with the API running and the two variables set; 404 without them, which is the
unmounted case and is correct.

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck && npm run lint
git commit -m "Open the three doors a wallet sign-in needs" -- workers/api/src/routes/wallet-auth.ts workers/api/src/app.ts workers/api/src/container.ts workers/api/src/env.ts workers/api/test/wallet-auth.test.ts
```

---

## Task 13: Connecting from the browser

**Files:**

- Create: `apps/web/src/features/wallet/lib/connect.ts`
- Test: `apps/web/test/connect.test.ts`

The browser's half is deliberately thin: it asks for a string, signs it, and sends it back. It
builds nothing, so there is no second builder to drift.

- [ ] **Step 1: Write the client**

```ts
// apps/web/src/features/wallet/lib/connect.ts

/** Anything that can sign a string for an address — MetaMask, Mera, WalletConnect. */
export interface Signer {
  address: string;
  chainId: number;
  signMessage(message: string): Promise<string>;
}

export interface ConnectResult {
  userId: string;
  session: { accessToken: string; refreshToken: string };
}

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

async function envelope(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ConnectError(body?.message ?? fallback, body?.error ?? String(response.status));
  }
  return body.data;
}

/**
 * The server hands back the exact string to sign and this signs it unchanged. Nothing here
 * constructs a SIWE message: one builder means a signature can never fail verification because two
 * builders disagreed by a byte, which is a failure that looks exactly like the wrong wallet.
 */
export async function signIn(
  signer: Signer,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectResult> {
  const issued = await envelope(
    await fetchImpl("/api/v1/auth/wallet/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: signer.address, chain_id: signer.chainId }),
    }),
    "Could not start a sign-in",
  );
  const signature = await signer.signMessage(issued.message);
  return envelope(
    await fetchImpl("/api/v1/auth/wallet/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: issued.message, signature }),
    }),
    "That sign-in did not go through",
  );
}
```

- [ ] **Step 2: Write the test**

```ts
// apps/web/test/connect.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { signIn, ConnectError } from "../src/features/wallet/lib/connect";

const MESSAGE = "pickler.fun wants you to sign in…\nNonce: n1";

function fakeFetch(steps: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const step = steps.shift()!;
    return new Response(JSON.stringify(step.body), { status: step.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("it signs the string the server sent, unchanged", async () => {
  const signed: string[] = [];
  const { impl, calls } = fakeFetch([
    { status: 200, body: { data: { nonce: "n1", message: MESSAGE } } },
    {
      status: 200,
      body: { data: { userId: "u1", session: { accessToken: "at", refreshToken: "rt" } } },
    },
  ]);
  const result = await signIn(
    {
      address: "0xabc0000000000000000000000000000000000001",
      chainId: 10143,
      signMessage: async (m) => {
        signed.push(m);
        return "0xsig";
      },
    },
    impl,
  );
  assert.deepEqual(signed, [MESSAGE]);
  // And it posts back exactly that string, not a rebuilt one.
  assert.equal((calls[1]!.body as { raw: string }).raw, MESSAGE);
  assert.equal(result.userId, "u1");
});

test("a refusal surfaces its code, so the screen can tell apart a stale nonce from a bad signature", async () => {
  const { impl } = fakeFetch([
    { status: 200, body: { data: { nonce: "n1", message: MESSAGE } } },
    { status: 400, body: { error: "nonce_invalid", message: "Ask for a new one" } },
  ]);
  await assert.rejects(
    () =>
      signIn(
        {
          address: "0xabc0000000000000000000000000000000000001",
          chainId: 10143,
          signMessage: async () => "0xsig",
        },
        impl,
      ),
    (caught: ConnectError) => caught.code === "nonce_invalid",
  );
});

test("a failure to get a nonce never reaches the wallet", async () => {
  let asked = false;
  const { impl } = fakeFetch([{ status: 500, body: {} }]);
  await assert.rejects(() =>
    signIn(
      {
        address: "0xabc0000000000000000000000000000000000001",
        chainId: 10143,
        signMessage: async () => {
          asked = true;
          return "0xsig";
        },
      },
      impl,
    ),
  );
  // Prompting for a signature that cannot be used trains people to approve prompts.
  assert.equal(asked, false);
});
```

- [ ] **Step 3: Run and prove the first test can fail**

Run: `node --import tsx --test apps/web/test/connect.test.ts`
Expected: PASS, 3 tests.

Then change the verify call to post `raw: issued.message.trim()`. Re-run.
Expected: the first test red on the posted string — which is the whole class of bug this shape
removes, demonstrated once.

Revert; 3 pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "Sign the string the server sent, and build none of our own" -- apps/web/src/features/wallet/lib/connect.ts apps/web/test/connect.test.ts
```

---

## Task 14: The two connectors, and the passkey that cannot be used

**Files:**

- Create: `apps/web/src/features/wallet/lib/signers.ts`
- Test: `apps/web/test/signers.test.ts`

Task 13 consumes a `Signer`; nothing yet produces one. This task does, for both wallets, and
handles the failure the Task 1 spike found.

**What the spike established**, so this is built on fact rather than on the plan's earlier guess:

- Mera exposes **no EIP-1193 provider**. Searching `category-labs/mera` for `1193`,
  `window.ethereum`, `wagmi` and `eip6963` returns nothing. It is an SDK whose adapter is
  `toViemAccount(session)`, returning a viem `LocalAccount<"mera">`.
- Its `signMessage({ message })` is `serializeSignature(await signHash(hashMessage(message)))` —
  viem's own `hashMessage`, so the string is signed unchanged with no wrapping — and the address is
  an ordinary EOA. **Server-side verification is plain `ecrecover`; there is no ERC-1271 path to
  add.** Task 10 needs no change.
- It works in desktop browsers, but **only where WebAuthn PRF is available.**

**Mera stays outside wagmi.** Writing a custom connector that synthesises a provider around the
`LocalAccount` is possible and is far more work than this needs: the ceremony wants exactly one
signature. Call the SDK directly for Mera, and leave wagmi to EOAs.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/signers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromViemAccount,
  PasskeyUnusableError,
  describeSignerFailure,
} from "../src/features/wallet/lib/signers";

test("a viem account becomes a Signer that signs the string it is given", async () => {
  const signed: string[] = [];
  const signer = fromViemAccount(
    {
      address: "0xAbC0000000000000000000000000000000000001",
      signMessage: async ({ message }: { message: string }) => {
        signed.push(message);
        return "0xsig";
      },
    },
    10143,
  );
  assert.equal(await signer.signMessage("hello"), "0xsig");
  // Signed unchanged: the server built this string and verifies that exact one.
  assert.deepEqual(signed, ["hello"]);
  assert.equal(signer.chainId, 10143);
});

test("a passkey with no PRF output is its own failure, not a generic error", () => {
  const caught = describeSignerFailure(
    new Error("createPasskeyWithPrfOutput failed: no prf results"),
  );
  assert.ok(caught instanceof PasskeyUnusableError);
});

test("an ordinary refusal stays an ordinary refusal", () => {
  const caught = describeSignerFailure(new Error("User rejected the request"));
  assert.ok(!(caught instanceof PasskeyUnusableError));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test apps/web/test/signers.test.ts`
Expected: FAIL, cannot find the module.

- [ ] **Step 3: Write it**

```ts
// apps/web/src/features/wallet/lib/signers.ts
import type { Signer } from "./connect";

/**
 * A passkey that exists and works for everything else, but produces no PRF output — so Mera
 * cannot derive a key from it.
 *
 * This is not an edge case to fold into a generic failure. Chrome creates a local-profile passkey
 * silently when "Offer to save passwords and passkeys" is off or an extension intercepts WebAuthn,
 * and local-profile passkeys, Bitwarden on desktop Chrome and Dashlane on desktop Chrome all had
 * no PRF support as of 2026-06-01. The person did nothing wrong, their passkey is fine everywhere
 * else, and "something went wrong" would send them to look for a problem that is not theirs.
 * iCloud Keychain, Google Password Manager, Windows Password Manager and hardware keys all work.
 */
export class PasskeyUnusableError extends Error {
  constructor() {
    super(
      "This passkey can't be used to hold a wallet. Your browser saved it somewhere that doesn't " +
        "support the feature Mera needs. Try again with iCloud Keychain, Google Password Manager, " +
        "Windows Hello or a security key — or connect an existing wallet instead.",
    );
    this.name = "PasskeyUnusableError";
  }
}

const PRF_FAILURE = /prf|createPasskeyWithPrfOutput/i;

/** Turns whatever a wallet threw into something a screen can say. */
export function describeSignerFailure(caught: unknown): Error {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  return PRF_FAILURE.test(error.message) ? new PasskeyUnusableError() : error;
}

/** Anything viem-shaped — Mera's `toViemAccount(session)`, or a wagmi EOA account. */
export interface ViemAccountLike {
  address: string;
  signMessage(input: { message: string }): Promise<string>;
}

export function fromViemAccount(account: ViemAccountLike, chainId: number): Signer {
  return {
    address: account.address,
    chainId,
    signMessage: (message) => account.signMessage({ message }),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test apps/web/test/signers.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the PRF branch can fail**

Make `describeSignerFailure` return `error` unconditionally. Re-run.
Expected: exactly one test red — "a passkey with no PRF output is its own failure". Revert.

- [ ] **Step 6: Wire both wallets**

Mera: `toViemAccount(session)` from `@category-labs/mera`, wrapped by `fromViemAccount`, with every
call to the SDK's passkey creation passed through `describeSignerFailure`. EOA: the account from
whatever wallet connection the marketplace already uses, wrapped the same way.

**Do not add `@category-labs/mera` to `package.json` until this task is the one being worked**, and
say in the commit which version you pinned. It is at `0.2.0`; a zero-major dependency in a sign-in
path is worth pinning exactly rather than by range.

- [ ] **Step 7: Commit**

```bash
git commit -m "Produce a signer from either wallet, and name the passkey that cannot hold one" -- apps/web/src/features/wallet/lib/signers.ts apps/web/test/signers.test.ts
```

---

## Task 15: Claiming a handle after connecting

**Files:**

- Create: `apps/web/src/features/wallet/components/claim-handle.tsx`
- Create: `apps/web/src/features/wallet/lib/handles.ts`
- Test: `apps/web/test/claim-handle.test.ts`
- Modify: `apps/web/src/features/wallet/components/portfolio-page.tsx`

The routes exist — `GET /v1/handles/:handle/availability` and `POST /v1/profile` — and neither core
nor the API changes. This is the screen that asks.

- [ ] **Step 1: Write the client, taking the rules from core**

```ts
// apps/web/src/features/wallet/lib/handles.ts
import { HANDLE_RULES, RESERVED_HANDLES } from "@pickler/core";

export type HandleProblem = "too_short" | "too_long" | "bad_characters" | "reserved" | "taken";

/**
 * The rules come from core. Restating `3..15` or the character class here would be a second copy
 * of a rule, and a second copy of a rule is a second rule: the day one moves, this screen accepts
 * what the API refuses and the person is told nothing useful.
 */
export function localProblem(raw: string): HandleProblem | null {
  const handle = raw.trim().toLowerCase();
  if (handle.length < HANDLE_RULES.min) return "too_short";
  if (handle.length > HANDLE_RULES.max) return "too_long";
  if (!HANDLE_RULES.pattern.test(handle)) return "bad_characters";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

export async function checkAvailability(handle: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`/api/v1/handles/${encodeURIComponent(handle)}/availability`);
  if (!response.ok) {
    // Never report "taken" from a failed lookup: it would tell someone their handle is gone when
    // the truth is that nobody looked.
    return { known: false as const };
  }
  const { data } = await response.json();
  return { known: true as const, available: data.available as boolean };
}

export async function claimHandle(
  input: { handle: string; displayName: string },
  token: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/v1/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ handle: input.handle, display_name: input.displayName }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "That handle could not be claimed");
  }
  return (await response.json()).data;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/test/claim-handle.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { localProblem, checkAvailability } from "../src/features/wallet/lib/handles";

test("the local rules match core's, including the reserved list", () => {
  assert.equal(localProblem("ab"), "too_short");
  assert.equal(localProblem("a".repeat(16)), "too_long");
  assert.equal(localProblem("has spaces"), "bad_characters");
  assert.equal(localProblem("Admin"), "reserved");
  assert.equal(localProblem("nightowl"), null);
});

test("a failed availability lookup is unknown, never taken", async () => {
  const failing = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await checkAvailability("nightowl", failing), { known: false });
});
```

- [ ] **Step 3: Run it, then prove the second test can fail**

Run: `node --import tsx --test apps/web/test/claim-handle.test.ts`
Expected: PASS, 2 tests.

Change the non-ok branch to `return { known: true, available: false }`. Re-run.
Expected: the second test red. That branch is the difference between "this name is gone" and "we
could not check", and only one of them is true. Revert.

- [ ] **Step 4: Build the panel**

`claim-handle.tsx` renders one field and one button, on the marketplace's light surface, using the
tokens from `@pickler/ui` — no literal colours. It shows `localProblem` as you type and the
availability result when the field is valid, and it is **dismissible**: claiming is not a gate.
Someone who dismisses it can still trade and the panel returns next visit. A person without a
handle is an address on the leaderboard, which is a worse experience rather than a blocked one.

Render it in `portfolio-page.tsx` when there is a session and no profile.

- [ ] **Step 5: Look at it**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/portfolio?state=connected"
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/contrast.mjs
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/shots.mjs
```

Expected: 200, contrast clean, and a screenshot you open and actually look at.

- [ ] **Step 6: Commit**

```bash
git commit -m "Ask for a handle once there is an account to hang it on" -- apps/web/src/features/wallet/lib/handles.ts apps/web/src/features/wallet/components/claim-handle.tsx apps/web/src/features/wallet/components/portfolio-page.tsx apps/web/test/claim-handle.test.ts
```

---

## Task 16: Move the passkey to where an agent needs it

**Files:**

- Modify: `apps/web/src/features/auth/lib/flow.ts`
- Test: `apps/web/test/auth-flow.test.ts`

§6 of the spec: the Turnkey sub-organization is created when someone builds their first agent, not
at signup. The ceremony does not change — `issueChallenge`, `register`, `prepareAddPasskey`,
`confirmAddPasskey`, the five tables and their tests all stay exactly as shipped. What moves is the
point in the product that calls it.

- [ ] **Step 1: Write the failing test**

```ts
test("signing up no longer asks for a passkey", () => {
  const steps = stepsFor("up");
  assert.deepEqual(steps, ["auth", "code", "handle", "welcome"]);
  assert.ok(!steps.includes("passkey"));
  assert.ok(!steps.includes("wallet"));
});

test("the custody steps still exist, for the flow that needs them", () => {
  assert.deepEqual(stepsFor("custody"), ["passkey", "wallet"]);
});

test("signing in is unchanged", () => {
  assert.deepEqual(stepsFor("in"), ["auth", "code"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test apps/web/test/auth-flow.test.ts`
Expected: FAIL — `up` still contains `passkey` and `wallet`.

- [ ] **Step 3: Move the steps**

In `apps/web/src/features/auth/lib/flow.ts`, take `{ label: "PASSKEY", steps: ["passkey"] }` and
`{ label: "BACKUP", steps: ["wallet"] }` out of the `"up"` progression and into a new `"custody"`
mode. Add `"custody"` to `Mode`. Leave every step's own logic alone.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test apps/web/test/auth-flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `/account` honest about having no wallet**

A person who has signed up but built no agent has no sub-organization and no master wallet.
`/account` must say that in the voice of the six panels that already say what is not built —
**not** render an empty wallet, which is indistinguishable from a wallet with nothing in it.

- [ ] **Step 6: Request the routes and look**

```bash
for r in /signup /signin /account; do
  printf "%-10s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001$r)"
done
```

Expected: all 200. Then screenshot `/account` and confirm it reads as "no wallet yet" rather than
as a wallet holding zero.

- [ ] **Step 7: Commit**

```bash
git commit -m "Ask for a passkey when an agent needs one, not at the door" -- apps/web/src/features/auth/lib/flow.ts apps/web/test/auth-flow.test.ts
```

---

## Task 17: What else has to know there are two hosts

**Files:**

- Modify: `scripts/design/routes.mjs`, `scripts/design/lib/render.mjs`
- Modify: `workers/api/wrangler.jsonc`, `apps/web/wrangler.jsonc`

- [ ] **Step 1: Give each design route its host**

`scripts/design/routes.mjs` measures one base URL. Each route gains a `product` field, and
`render.mjs` chooses a base URL for it:

```js
// scripts/design/routes.mjs — one field per route
{ name: "leaderboard", path: "/leaderboard", product: "marketplace", proves: "#score", ... }
{ name: "studio",      path: "/console",     product: "studio",      proves: "nav[aria-label=\"Studio sections\"]", ... }
```

```js
// scripts/design/lib/render.mjs
/**
 * One base URL still works and is what development uses, because the middleware is inert on
 * localhost and both products answer on one origin. DESIGN_BASE_URL stays required and still
 * refuses to guess: port 3000 on this machine is another checkout of this repository serving its
 * own branch, and a default there measures somebody else's design and reports plausible numbers.
 */
const BASE_FOR = {
  marketplace: process.env.DESIGN_MARKETPLACE_URL ?? BASE,
  studio: process.env.DESIGN_STUDIO_URL ?? BASE,
};
const baseFor = (route) => BASE_FOR[route.product] ?? BASE;
```

Replace `BASE + route.path` at `render.mjs:187` with `baseFor(route) + route.path`, and the failure
message at line 106 with `${baseFor(route)}` so a reader can see which server did not answer.

Verify it is a no-op locally before believing it:

```bash
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/surfaces.mjs
```

Expected: clean over all 15 routes, exactly as before.

- [ ] **Step 2: List both origins for CORS**

`ALLOWED_ORIGINS` on the API must carry `https://pickler.fun` and `https://app.pickler.fun`. A
missing origin fails only in a browser, and never in a test or a `curl`.

- [ ] **Step 3: Record what has to be set outside the code**

Append to `docs/specs/user-profiles-and-products-v1.md` a section **"Before this works in a
deployment"**, in the shape of §10 of the custody spec:

- `NEXT_PUBLIC_MARKETPLACE_HOST`, `NEXT_PUBLIC_STUDIO_HOST` on the web worker.
- `SIWE_DOMAIN` and `WALLET_EMAIL_DOMAIN` on the API worker, without which the wallet routes are
  not mounted.
- `ALLOWED_ORIGINS` carrying both origins.
- Supabase redirect URLs carrying both callback origins.
- Both hostnames pointed at the web worker.
- `TURNKEY_RPID=pickler.fun`, and the reason it cannot be changed later.

- [ ] **Step 4: Commit**

```bash
git commit -m "Tell the checks and the deployment that there are two hosts" -- scripts/design docs/specs/user-profiles-and-products-v1.md workers/api/wrangler.jsonc apps/web/wrangler.jsonc
```

---

## Task 18: The whole thing, at once

**Files:** none changed unless a check fails.

- [ ] **Step 1: Every gate**

```bash
npm run typecheck && npm run lint && npx prettier --check . && npm test && npx turbo build --filter=@pickler/web
```

- [ ] **Step 2: Every design check**

```bash
export DESIGN_BASE_URL=http://localhost:3001
for check in surfaces tokens contrast type; do echo "=== $check ==="; node scripts/design/$check.mjs || echo FAILED; done
node scripts/design/shots.mjs
node --test scripts/design/*.test.mjs
```

- [ ] **Step 3: Request every route on both products**

```bash
for r in / /leaderboard /portfolio /console /account; do
  printf "%-12s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001$r)"
done
```

Expected: all 200, because the middleware is inert on localhost. A 404 here means the host mapping
is matching something it should not.

- [ ] **Step 4: Sign in once, by hand**

With the API running and `SIWE_DOMAIN` set, complete one real ceremony in a browser with a wallet:
connect, sign, land with a session, reload and still be signed in. Then do it again with the same
wallet and confirm you arrive at the **same** account rather than a second one. That is the whole
point of this specification and no automated test in this plan proves it end to end.

- [ ] **Step 5: Record the result**

Add a `## Validation` section to `docs/specs/user-profiles-and-products-v1.md`: the date, what was
checked, what behaved differently from this plan, and anything left undone.

```bash
git commit -m "Record what the first wallet sign-in actually did" -- docs/specs/user-profiles-and-products-v1.md
```

---

## What this plan does not do

Paid reads, which have no persistence to attach an account to. Mera's own connector beyond the
Task 1 spike. Merging two accounts, which this design makes unreachable rather than solvable.
Specification two of the custody work — agent sub-wallets, spend caps and the two-of-two policies.

# Product hosts cutover v2

Status: Draft — decided autonomously 2026-09-30. Builds `docs/specs/product-hosts-v1.md` for real
and revises it where the owner's wallet rule (`docs/product-map/conventions.md`, "Products and
wallets") or the hosting platform proved it wrong. Everything in v1 not contradicted here stands.

Research this builds on: `docs/product-map/research/05-identity-studio-mobile.md` §2.4, §3 gaps
1–3, §7; `docs/product-map/research/06-platform.md` G3, G4.

---

## 1. Problem and users

`product-hosts-v1.md` decided three hosts — `pickler.fun` landing, `app.pickler.fun` marketplace,
`studio.pickler.fun` studio — and none of it is built:

- `apps/web/src/server/hosts.ts:2` knows two products, and its fallbacks put the **studio on
  `app.pickler.fun`** (`hosts.ts:11-12`), the host meant for the marketplace and Mera's relying
  party. A deploy without build-time host values would enrol Turnkey passkeys on the wrong host.
- `app.pickler.fun` and `studio.pickler.fun` have no DNS records (research 05 §2.6), so the studio,
  signup and passkey screens are unreachable on any public host.
- The AASA file is in `apps/web/public/.well-known/` and is served on every host.
  `product-hosts-v1.md:156-160` wants the middleware to 404 it off the marketplace, but Workers
  Assets serves `public/` before the Worker runs (PR #31), and `apps/web/wrangler.jsonc:9` has no
  `run_worker_first`, so the middleware never sees the request.
- `product-hosts-v1.md` §2 and §7 keep Mera off the web. The owner's rule (2026-09-30) puts Mera on
  the marketplace on **web and phone**, with an injected EOA as a web-only alternative. The host
  split is the precondition for that: Mera's RP and Turnkey's RP must be different hosts first.

Users: people reading the marketplace (they must not lose `pickler.fun/agents` links that have
worked since 2026-09-20); agent builders (the studio must exist on a host whose RP never moves);
the iOS app (its associated domains must name a host that serves the right file); the operator
(an ordered cutover with a rollback that is honest about the one-way door).

---

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reason                                                                                                                                                                                               | Reversible?                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| H1  | Three hosts exactly as v1 §1: `pickler.fun` landing, `app.pickler.fun` marketplace, `studio.pickler.fun` studio, all served by one web Worker.                                                                                                                                                                                                                                                                                                                                                                                                                                               | v1's reasons stand; one Worker keeps one build.                                                                                                                                                      | Yes, except H5.                                              |
| H2  | `Product` becomes `"landing" \| "marketplace" \| "studio" \| "either"`. Fallbacks `pickler.fun`, `app.pickler.fun`, `studio.pickler.fun` (v1 §6).                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fixes the fallback that points the studio at the Mera host.                                                                                                                                          | Yes.                                                         |
| H3  | A **deployed build refuses to compile without all three `NEXT_PUBLIC_*_HOST` values** (`apps/web/scripts/assert-hosts.mjs`, run by `build:worker` when `PICKLER_DEPLOY_ENV` is `staging` or `production`). Previews leave them unset and stay `"either"`.                                                                                                                                                                                                                                                                                                                                    | Fallbacks are for development; `user-profiles-and-products-v1.md:552-571` shows a missing build value fails silently.                                                                                | Yes.                                                         |
| H4  | **Departure from v1:** on the landing host, marketplace paths answer **308 to the same path on `app.pickler.fun`** (query kept). Studio paths on the landing answer 404.                                                                                                                                                                                                                                                                                                                                                                                                                     | v1 §6 assumed "nothing has ever been deployed". Since 2026-09-20 `pickler.fun/agents` and friends are public, shared and in TestFlight builds. A redirect costs one branch; a dead link costs trust. | Yes (drop the branch after 90 days of no hits in logs).      |
| H5  | **`TURNKEY_RPID=studio.pickler.fun`** — one-way door, still choosable because no passkey has been enrolled on any deployed environment (`/v1/signing` is unmounted everywhere hosted, research 05 §2.6).                                                                                                                                                                                                                                                                                                                                                                                     | v1 §3.                                                                                                                                                                                               | **No**, once the first passkey is enrolled.                  |
| H6  | **Mera's relying party is `app.pickler.fun` on web and mobile.** The web Mera connector (`marketplace-wallets-v1.md`) must use `rpId: "app.pickler.fun"`, the same as the phone, and must not ship before this cutover.                                                                                                                                                                                                                                                                                                                                                                      | Owner's rule. Same RP and the PRF model give the same derived address on web and phone (research 05 §7.3). Different hosts keep the two passkey kinds apart (§2.1).                                  | **No** once a Mera passkey is enrolled on it (v1 §8).        |
| H7  | `SIWE_DOMAIN=app.pickler.fun`, one value for web EOA, web Mera and phone. `WALLET_EMAIL_DOMAIN=wallet.pickler.fun` (never MX).                                                                                                                                                                                                                                                                                                                                                                                                                                                               | v1 §4; `user-profiles-and-products-v1.md` §14.                                                                                                                                                       | Yes (re-sign after a change).                                |
| H8  | **AASA and `assetlinks.json` move out of `public/`** into route handlers that answer per host: 200 on the marketplace host only, 404 on landing and studio, 200 on `either`. `assets.run_worker_first: ["/.well-known/*"]` is added as a second guard.                                                                                                                                                                                                                                                                                                                                       | With the file out of `public/`, no asset matches, so the Worker always runs; `run_worker_first` keeps that true if someone puts a file back.                                                         | Yes.                                                         |
| H9  | **The apex keeps serving `webcredentials` for 90 days after the cutover** (conventions decision 14; cross-review X2). `AASA_ON_LANDING` defaults to `true` in production; on the landing host `aasaFor` returns `webcredentials` only (no `applinks`), so TestFlight builds that name `pickler.fun` keep working and the app can offer "Move your funds" (derive the legacy `pickler.fun` address, show its balance, sweep AUSD and MON to the `app.pickler.fun` address; owned by `mobile-backend-v1.md`). The flag flips to `false` in a normal release on day 90, recorded in the ledger. | An apex association lets any subdomain, the studio included, request a `pickler.fun` Mera assertion (§2.1). The window bounds that risk; stranding testers' funds is worse.                          | Yes (the flag); the end date is the owner's to extend.       |
| H10 | One `hrefFor(from, to, path, hosts)` replaces `studioHref`, `studioUrl` and `marketplaceUrl` (`hosts.ts:106-137`; callers `apps/web/src/features/site/studio-href.tsx:15-40`, `apps/web/src/app/auth/callback/route.ts:40`).                                                                                                                                                                                                                                                                                                                                                                 | v1 §6; three functions for one rule have already drifted once (the studio-root special case).                                                                                                        | Yes.                                                         |
| H11 | Staging gets its own three hosts under the same zone, one level deep so Universal SSL covers them: `stg.pickler.fun`, `app-stg.pickler.fun`, `studio-stg.pickler.fun`. Staging `TURNKEY_RPID=studio-stg.pickler.fun`, `SIWE_DOMAIN=app-stg.pickler.fun`.                                                                                                                                                                                                                                                                                                                                     | Lets the cutover be rehearsed with real host behaviour. None of these hosts is inside `studio.pickler.fun`'s or `app.pickler.fun`'s scope.                                                           | Yes until a staging passkey is enrolled (staging-only door). |
| H12 | Studio sign-out lands on `https://pickler.fun/`; the studio logo links to the landing; "See the marketplace" links to `https://app.pickler.fun/agents`. The landing's "Explore" → `app.`, "Build an agent" → `studio.pickler.fun/apply`.                                                                                                                                                                                                                                                                                                                                                     | v1 §6 names these links; this fixes their targets.                                                                                                                                                   | Yes.                                                         |

### 2.1 What the RP split actually protects (clarifies v1 §4)

v1 says an apex Mera credential "is offered on `studio.pickler.fun` — in Turnkey's picker". More
precisely: WebAuthn offers only credentials whose `rpId` equals the `rpId` the page requests, so
Turnkey's ceremony (`rpId: studio.pickler.fun`) never lists an apex credential. What an apex RP does
allow is for **any page on any subdomain**, including the studio, to request an assertion for
`rpId: pickler.fun`, and with PRF that assertion is Mera's seed. A compromised or third-party
subdomain could then derive the marketplace key. With Mera on `app.pickler.fun`, no other origin may
request that RP at all. The conclusion of v1 (never the apex) is unchanged; the reason is sharper.

---

## 3. User flows

### 3.1 A reader with an old link

`https://pickler.fun/agents/lime-fox?tab=picks` → 308 → `https://app.pickler.fun/agents/lime-fox?tab=picks`
→ 200. `https://pickler.fun/` → the landing. `https://pickler.fun/studio` → 404.

### 3.2 Someone who wants to build an agent

Landing → "Build an agent" → `https://studio.pickler.fun/apply` → signup on the studio host
(email OTP, Supabase redirect `https://studio.pickler.fun/auth/callback`) → passkey enrolled with
`rpId: studio.pickler.fun` → studio at `https://studio.pickler.fun/`.

### 3.3 A marketplace reader who connects a wallet (web)

`https://app.pickler.fun/agents` → connect → chooser offers Mera (after `marketplace-wallets-v1.md`
ships) or a browser wallet → SIWE message built by the API with `domain: app.pickler.fun`
(`packages/core/src/features/identity/application/wallet-sign-in.ts:190-209`) → verify → session
cookie on `app.pickler.fun` only.

### 3.4 The iOS app

The app carries `webcredentials:app.pickler.fun`, `applinks:app.pickler.fun`, Mera `rpId`
`app.pickler.fun` and SIWE domain `app.pickler.fun` (v1 §4 table). It calls the API at
`https://app.pickler.fun/api/v1` — **correcting v1 §4**, which said "the API is its own worker" and
the base URL does not change: `pickler-api-*` has no public route (`workers/api/wrangler.staging.jsonc:8-9`),
so the web proxy on the marketplace host is the only public entry (research 05 §2.5).
`https://app.pickler.fun/agents/<handle>` opens the agent in the app.

---

## 4. API

No new API routes. Configuration changes on the API Worker (production values; staging per H11):

| Name                  | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `TURNKEY_RPID`        | `studio.pickler.fun`                                                     |
| `SIWE_DOMAIN`         | `app.pickler.fun`                                                        |
| `WALLET_EMAIL_DOMAIN` | `wallet.pickler.fun`                                                     |
| `ALLOWED_ORIGINS`     | `https://pickler.fun,https://app.pickler.fun,https://studio.pickler.fun` |

New web routes (Next route handlers, not the API):

| Method | Path                                      | Host rule                                                                                                                                                   | Response                                                                                                   |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/.well-known/apple-app-site-association` | 200 on marketplace and `either`; landing: 200 with `webcredentials` only while `AASA_ON_LANDING=true` (the 90-day window, H9), else 404; studio: always 404 | `application/json`, `Cache-Control: public, max-age=3600`, no redirect. Body from `aasaFor(product)` (§5). |
| GET    | `/.well-known/assetlinks.json`            | same                                                                                                                                                        | `application/json`; `[]` until the Android package name and signing fingerprint exist (§12 Q3).            |

Errors: none beyond 404. The handlers are dynamic, because the answer depends on the host; they read
no data, and the `Cache-Control` header lets Apple's CDN cache them.

---

## 5. Data model and code changes

No database change.

**`apps/web/src/server/hosts.ts`**

```ts
export type Product = "landing" | "marketplace" | "studio" | "either";
export interface ProductHosts {
  landing: string;
  marketplace: string;
  studio: string;
}
export const PRODUCT_HOSTS: ProductHosts = {
  landing: process.env.NEXT_PUBLIC_LANDING_HOST ?? "pickler.fun",
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_HOST ?? "app.pickler.fun",
  studio: process.env.NEXT_PUBLIC_STUDIO_HOST ?? "studio.pickler.fun",
};
```

- `productFor` compares against three names, equality only (unchanged rule, `hosts.ts:16-35`).
- `LANDING_SEGMENTS = new Set([""])` — the landing owns `/` only. Future static sections (`about`,
  `docs`) are added here.
- `ownerOf`: shared → `either`; landing segment → `landing`; studio segment → `studio`; else
  `marketplace`. `.well-known` stays shared at the ownership level; the per-host rule lives in the
  route handler (H8), so `hosts.test.ts:73` keeps passing and a new test pins the handler.
- `hrefFor(from: Product, to: "landing" | "marketplace" | "studio", path: string, hosts)`:
  - canonical path for the target: studio `"/studio…"` → `"/…"`; marketplace and landing unchanged;
  - `from === to` → the canonical path, relative;
  - `from === "either"` → the development path (studio root stays `/studio`, landing is `/`);
  - otherwise → `https://${hosts[to]}${canonical}`.
- `aasaFor(product, { onLanding })` returns the AASA object or `null`:

```json
{
  "webcredentials": { "apps": ["2PBQJ37Q8W.fun.pickler.app"] },
  "applinks": {
    "details": [
      {
        "appIDs": ["2PBQJ37Q8W.fun.pickler.app"],
        "components": "UNIVERSAL_LINK_PATHS"
      }
    ]
  }
}
```

The app id comes from today's file (`apps/web/public/.well-known/apple-app-site-association:1`).
`components` is built from **one constant**, `UNIVERSAL_LINK_PATHS` in `apps/web/src/server/aasa.ts`,
whose content is owned by `mobile-backend-v1.md` M10 (it owns the app contract; cross-review C10):
`/agents/*`, `/tokens/*`, `/reads/*`, `/markets/*`, `/portfolio`, `/receipts/*`. A change to the list
is a change to that spec first. On the landing host during the H9 window, `aasaFor` returns only the
`webcredentials` key.

**`apps/web/src/middleware.ts`** — `decide` gains one kind and three rules, in this order:

1. Studio host, `/studio` → `notFound` (unchanged, `middleware.ts:49-51`).
2. Root: landing `/` → `serve`; marketplace `/` → `rewrite /agents`; studio `/` → `rewrite /studio`
   (unchanged).
3. Landing host and `ownerOf(path) === "marketplace"` → `{ kind: "redirect", to: "https://<marketplace><path><query>", status: 308 }` (H4).
4. Any other owner mismatch → `notFound` (unchanged rule, now over three products).
5. Guard (unchanged, `middleware.ts:68-70`).

`Decision` gains `{ kind: "redirect"; to: string; status: 308 }`; the switch at `middleware.ts:86-105`
answers it with `NextResponse.redirect(to, 308)` and `Cache-Control: public, max-age=86400`.

**Files moved or removed**

- Delete `apps/web/public/.well-known/apple-app-site-association` and its block in
  `apps/web/public/_headers:4-7` (which also carries the stale comment "relying party pickler.fun").
- Add `apps/web/src/app/.well-known/apple-app-site-association/route.ts` and
  `apps/web/src/app/.well-known/assetlinks.json/route.ts`.
- `apps/web/wrangler.jsonc` and `wrangler.production.jsonc`:
  `"assets": { "directory": ".open-next/assets", "binding": "ASSETS", "run_worker_first": ["/.well-known/*"] }`.
- `apps/web/scripts/assert-hosts.mjs` (H3), called at the start of `build:worker`.
- `features/site/studio-href.tsx`: `useStudioHref` etc. become thin wrappers over `hrefFor`; a
  `useHref(to, path)` hook is added; call sites that link to the landing use it.
- `apps/web/AGENTS.md` describes three hosts and the AASA handler; `workers/api/.dev.vars.example`
  gains the comment that production values are in this spec.

**Documentation corrections in the same PR** (research 05 §7.2): `product-hosts-v1.md` §2, §4 (API
base URL) and §7 "Mera on the web" get a one-line pointer to this spec;
`turnkey-passkey-custody-v1.md` §6 records that the PRF signer's retirement was about the shared
host, not a ban on Mera; `apps/web/AGENTS.md:78` and `features/wallet/lib/signer.ts:9-11` stop
calling the Turnkey master wallet "the person's own Pickler wallet" on the marketplace side.

---

## 6. Integrations

### 6.1 DNS and Worker routes

Zone `pickler.fun` is in account `bc8d4adf…` (PR #31). Custom domains are declared in the web
Worker's config (`production-environment-v1.md` D5):

| Hostname                       | Target                                                                            | Record                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pickler.fun`                  | web Worker (custom domain)                                                        | managed by Custom Domains                                                                       |
| `app.pickler.fun`              | web Worker (custom domain)                                                        | managed by Custom Domains                                                                       |
| `studio.pickler.fun`           | web Worker (custom domain)                                                        | managed by Custom Domains                                                                       |
| `wallet.pickler.fun`           | **none**; add a `TXT` `v=spf1 -all` and a null MX `0 .` to state it takes no mail | explicit "no mail", checked by `dns.mx`                                                         |
| `stg`, `app-stg`, `studio-stg` | `pickler-web-staging` (custom domain)                                             | managed by Custom Domains                                                                       |
| `media.pickler.fun`            | R2 bucket `pickler-media-production` (R2 custom domain)                           | managed by R2; `token-launch-v1.md` T5                                                          |
| `media-staging.pickler.fun`    | R2 bucket `pickler-media-staging`                                                 | managed by R2                                                                                   |
| `mail.pickler.fun`             | sending domain for Resend (Auth and transactional mail)                           | SPF `include:` Resend, DKIM CNAMEs, DMARC `p=quarantine`; no inbound MX (`operations-v1.md` O9) |
| `sign.app.pickler.fun`         | reserved for the v1.1 signer iframe (`marketplace-wallets-v1.md`)                 | none yet; two levels deep, so it needs an Advanced Certificate or a one-level name when built   |

This table is the zone's full inventory (cross-review W9): a spec that adds a hostname adds its row
here in the same PR.

A custom domain can be attached to only one Worker at a time; moving `pickler.fun` from
`pickler-web-staging` to `pickler-web-production` is a detach then attach (seconds of 522), done in
the production cutover of `production-environment-v1.md` §10 step 6, not here.

### 6.2 Supabase Auth (per project)

Site URL `https://studio.pickler.fun`; redirect allow list
`https://studio.pickler.fun/auth/callback` only (v1 §6). Staging: `https://studio-stg.pickler.fun`
and its callback, plus the existing workers.dev callback until it is retired.

### 6.3 Web build environment (Workers Builds for previews, Actions for staging/production)

`NEXT_PUBLIC_LANDING_HOST`, `NEXT_PUBLIC_MARKETPLACE_HOST`, `NEXT_PUBLIC_STUDIO_HOST`,
`PICKLER_DEPLOY_ENV`, `AASA_ON_LANDING`. The readiness verifier's `build.hosts` item greps the built
output for the three literals (`production-environment-v1.md` §4.3).

### 6.4 The iOS app (outside this repository)

Four values to `app.pickler.fun` (v1 §4 table) and the API base URL to
`https://app.pickler.fun/api/v1`. Owner of the app repository to confirm (§12 Q1). Android:
`assetlinks.json` with `delegate_permission/common.get_login_creds` and
`delegate_permission/common.handle_all_urls` once a package exists.

---

## 7. Design work

| Screen                                               | Surface     | Canvas                                                                    | States  |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------- | ------- |
| Landing header and footer links                      | landing     | existing landing canvas (`design-system-v2.md`); only link targets change | default |
| Studio header: logo → landing, "See the marketplace" | studio      | existing studio canvas; no visual change                                  | default |
| Marketplace header: "Build an agent" → studio        | marketplace | existing                                                                  | default |
| 404 on a studio path from the landing                | landing     | existing `not-found`                                                      | —       |

No new canvas. The design harness gains a `landing` product and base URL
(`design-harness-v3.md` §4.2).

---

## 8. Security and abuse

- The RP separation is the security property (§2.1). The verifier asserts `TURNKEY_RPID` on every
  production release; nothing else in the codebase may default it to a host (the local default
  `localhost`, `workers/api/wrangler.jsonc:37`, is the only allowed default).
- Host matching stays equality only (`hosts.ts:20-21`): `evilpickler.fun` is not a product.
- The 308 target is built from `PRODUCT_HOSTS.marketplace` and the request's path and query only,
  never from a request header, so it cannot become an open redirect.
- AASA is not served on the studio host in any configuration: `aasaFor("studio")` returns `null`
  and a test pins it.
- Session cookies stay host-scoped (v1 §5); no cookie is set with `Domain=pickler.fun`. A test in
  `apps/web/test/` asserts that the Supabase cookie options have no `domain`.
- `wallet.pickler.fun` gets an explicit null MX and `-all` SPF so "no mail" is a record, not an
  absence.

---

## 9. Acceptance criteria and tests

Unit (`apps/web/test/hosts.test.ts`, `middleware.test.ts`, new `aasa.test.ts`):

1. `productFor` over the three hosts, uppercase, with ports, and `evilpickler.fun` → `either`.
2. `decide`: landing `/` serve; landing `/agents?x=1` → 308 to `https://app.pickler.fun/agents?x=1`;
   landing `/studio` → 404; marketplace `/` → rewrite `/agents`; marketplace `/signup` → 404;
   studio `/` → rewrite `/studio`; studio `/agents` → 404; `localhost` serves everything.
3. `hrefFor` for all nine `(from, to)` pairs plus `either`, including `/studio?agent=x` → `/?agent=x`
   on the studio host.
4. `aasaFor`: marketplace and `either` return the object; studio `null` always; landing
   `{ webcredentials }` only when `onLanding`, else `null`. `webcredentials.apps` and every
   `applinks.details[].appIDs` name the same id; `components` equals `UNIVERSAL_LINK_PATHS`.
5. `assert-hosts.mjs` fails with a message naming the missing variable when
   `PICKLER_DEPLOY_ENV=production` and any host is unset; passes for `preview`.

Remote (smoke list, `production-environment-v1.md` §3.6), after cutover:

6. `curl -sI https://pickler.fun/agents` → 308 `location: https://app.pickler.fun/agents`.
7. `curl -s https://app.pickler.fun/.well-known/apple-app-site-association` → 200 JSON with
   `applinks`; on `studio.pickler.fun` → 404; on `pickler.fun` → 200 with `webcredentials` only during
   the 90-day window (H9), 404 after step 9.
8. `POST https://app.pickler.fun/api/v1/auth/wallet/nonce` → the returned `message` contains
   `app.pickler.fun wants you to sign in`.
9. A passkey enrolled on `https://studio-stg.pickler.fun` completes the ceremony (staging rehearsal);
   the same browser offers no credential on `https://app-stg.pickler.fun` Mera prompt (manual check).
10. Apple's AASA validator (or `swcutil` on a Mac) reports the association for `app.pickler.fun`.

---

## 10. Rollout and dependencies

### 10.1 Cutover order (staging rehearsal first, then production)

Run once on staging hosts (H11), then on production. Each step has a check; stop on failure.

| Step | Action                                                                                                                                                                                                                                                   | Check                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0    | Prerequisites: `production-environment-v1.md` §0.1 (degraded reads) and §0.2 Step A (API from main) are live. Code PR (§5) merged to `main`.                                                                                                             | smoke green on the current host                                                            |
| 1    | Attach `app.` and `studio.` custom domains to the web Worker that serves `pickler.fun` today. The running (old) build treats them per its old fallbacks; nobody knows these hosts yet, and `/v1/signing` is still unmounted, so nothing can be enrolled. | `dig` resolves; TLS valid                                                                  |
| 2    | Deploy the web from the merged commit with the three `NEXT_PUBLIC_*_HOST` build values.                                                                                                                                                                  | §9 checks 6–7; `pickler.fun/` is the landing                                               |
| 3    | Supabase: site URL and redirect list (§6.2); email confirmations on; `{{ .Token }}` templates.                                                                                                                                                           | verifier `auth.*` items                                                                    |
| 4    | Grant `auth.users`/`auth.identities` to the Hyperdrive role (`production-environment-v1.md` §5.2).                                                                                                                                                       | verifier `db.auth_grants`                                                                  |
| 5    | Redeploy the API with §4 values and the Turnkey secrets (**Step B**). This is the step that opens the one-way door.                                                                                                                                      | verifier `vars.rpid`, `vars.siwe`, `vars.origins` PASS; `/api/v1/signing/wallets/me` → 401 |
| 6    | Readiness verifier and smoke, full list.                                                                                                                                                                                                                 | exit 0                                                                                     |
| 7    | One enrolment by the owner on `studio.pickler.fun` (the first passkey). Record in the ledger as `"rpid-committed": "studio.pickler.fun"`.                                                                                                                | ceremony completes; `wallets` has one sub-organisation row                                 |
| 8    | Ship the iOS build with the four `app.pickler.fun` values and the "Move your funds" flow (`mobile-backend-v1.md`, decision 14).                                                                                                                          | §9 check 10                                                                                |

| 9 | Day 90 after step 2: release with `AASA_ON_LANDING=false`; the apex stops serving `webcredentials`. Earlier only if the owner confirms no TestFlight address holds funds. | `curl https://pickler.fun/.well-known/apple-app-site-association` → 404; ledger entry |

### 10.2 Rollback

- **Before step 5:** fully reversible. `wrangler rollback` the web to the ledger's previous version
  (the old two-host build), detach `app.`/`studio.`. Nothing was enrolled.
- **After step 5, before step 7:** still reversible in practice. Redeploy the API without the
  Turnkey and SIWE values (`/v1/signing` and `/v1/auth/wallet` unmount), roll back the web. Check
  first that `wallets` has zero sub-organisation rows; if it has one, you are after step 7.
- **After step 7:** the web and the API may be rolled back to any version that keeps
  `TURNKEY_RPID=studio.pickler.fun`. **The RP value is never rolled back.** If `studio.pickler.fun`
  must stop serving, it serves a maintenance page from the same host; it does not move.
- The 308 from the landing (H4) is removed by a normal deploy if it misbehaves; browsers cache 308,
  so the header is `max-age=86400`, not immutable.

Depends on: `production-environment-v1.md` (§0, the verifier, the ledger). Enables:
`marketplace-wallets-v1.md` (web Mera, H6), `mobile-backend-v1.md`, every studio feature that needs a
public studio. `design-harness-v3.md` takes the third base URL.

---

## 11. Out of scope

- The web Mera connector itself (`marketplace-wallets-v1.md`), the marketplace wallets section (v1 §5),
  and `wallet_links.kind` on verify/link — identity-area specs.
- Giving the API its own public hostname (`api.pickler.fun`); the proxy is enough today.
- WalletConnect, ERC-1271, Solana (v1 §7).
- Content for new landing sections.

---

## 12. Open questions for the owner

1. **Where is the iOS app's source, and who ships the build with `app.pickler.fun`?** It is not in any
   Picklerfun repository (research 05 Q1). Step 8 cannot be done from here.
2. Is 90 days the right window for the apex `webcredentials` (H9, decision 14)? If no TestFlight
   address holds funds, it can end as soon as the new build ships.
3. Android: is there a package name and signing key yet (for `assetlinks.json`)?
4. Do you accept the key-in-page risk of Mera on the web (research 05 §7.2 item 1)? This spec only
   gives it the right host; the connector spec needs your answer.

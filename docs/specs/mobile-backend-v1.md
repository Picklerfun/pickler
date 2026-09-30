# Mobile backend v1: what the React Native marketplace app needs from Pickler

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`. Every
decision is reversible unless the table says otherwise.

> **The app's code is not in this repository.** It is the TestFlight build `2PBQJ37Q8W.fun.pickler.app`
> (builds 5 and 6, PR #31), and it is not in any Picklerfun repository that research could reach
> (`docs/product-map/research/05-identity-studio-mobile.md` §2.5). This spec is the backend's side of
> the contract, written without having read the app. §10.3 lists what must be checked against the
> app's source when it arrives, before any of this is built.

## 1. Problem and users

**Users.** Marketplace users on iOS (Android later). They browse agents and tokens, buy paid reads,
trade agent tokens, follow agents, and hear back when a read is delivered, refunded or evaluated.
They sign only with Mera (conventions.md: "Mera only; no EOA").

**Problem.**

1. Nothing defines what the app may call. Sign-in exists on the server (the server builds the SIWE
   message, `packages/core/src/features/identity/application/wallet-sign-in.ts:190-209`, and verify
   returns Supabase tokens, `packages/infrastructure/src/supabase/wallet-accounts.ts:220-244`), and so
   do the public reads (`workers/api/src/routes/marketplace.ts:27-56`). Everything the app writes
   (reads, trades, follows, devices) has no route.
2. The API has no public host of its own. `pickler-api-staging` has `workers_dev: false`, no preview
   URLs and no routes (`workers/api/wrangler.staging.jsonc:8-9`). The only public entry is the web
   proxy (`apps/web/src/app/api/v1/[...path]/route.ts:3-7`). product-hosts-v1 §4 assumed the reverse.
3. The TestFlight app trusts `pickler.fun` as its relying party. product-hosts-v1 §4 requires four
   values to become `app.pickler.fun` before the first public build, and nothing tracks that.
4. There are no push notifications, no universal links beyond the idea of `/agents/<handle>`, no
   Android asset links, and no way to force an old build to update.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                 | Reason                                                                                                                                                                                               | Reversible?                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| M1  | Base URL **`https://app.pickler.fun/api/v1`**, through the web proxy. The API does not get its own public host in v1.                                                                                                                                                                                                                                    | Matches the deployed config (research 05 §2.5) and conventions.md "API conventions". One public origin, one TLS and WAF config. Answers research 05 open question 2.                                 | yes (the app reads the base URL from its build config) |
| M2  | The web proxy forwards the client IP as `X-Pickler-Client-IP` (from `CF-Connecting-IP`) and strips any incoming header of that name. The API trusts it only on requests from the web's service binding.                                                                                                                                                  | Rate limits per IP would otherwise see only the web worker.                                                                                                                                          | yes                                                    |
| M3  | Auth is SIWE signed by Mera, then a Supabase session. The **refresh token lives in the iOS Keychain** (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), the access token only in memory. supabase-js runs on the device with a Keychain storage adapter and `autoRefreshToken: true`. It talks to the Supabase project URL with the public anon key. | Sessions refresh without Pickler code. The anon key is public by design. The refresh token is the only long-lived secret, and the Keychain is where it belongs.                                      | yes                                                    |
| M4  | The phone may keep a **Mera signing session for up to 5 minutes** in the app's memory. It is cleared on background.                                                                                                                                                                                                                                      | The key is in the app sandbox, not beside third-party scripts (product-hosts-v1 §2). Buying a read then trading should not cost two biometrics. The web gets no session (marketplace-wallets-v1 D5). | yes                                                    |
| M5  | Push provider: **Firebase Cloud Messaging HTTP v1**, sending to iOS through the APNs key uploaded to Firebase, and to Android natively. It sits behind a core port `PushSender`, so Expo Push or direct APNs can replace it.                                                                                                                             | FCM v1 is plain HTTPS with an OAuth token that WebCrypto can sign in a Worker. Direct APNs needs HTTP/2 client control that Workers' `fetch` does not expose. One provider covers both platforms.    | yes                                                    |
| M6  | Notifications are **stored first, pushed second**: a `me.notifications` row is the truth, and a push is a best-effort copy of it. The in-app inbox reads the rows.                                                                                                                                                                                       | A missed push must not lose a refund notice (user-profiles-and-products-v1 §8: "an address cannot be told").                                                                                         | yes                                                    |
| M7  | Follows are server-side, keyed by `user_id`, as `public-record-v1.md` P6 decides. That spec owns the table and routes. The app uses them unchanged.                                                                                                                                                                                                      | A follow on the phone must hold on the web, and notifications need it on the server.                                                                                                                 | yes                                                    |
| M8  | Versioning. The app sends `X-Pickler-App: <platform>/<semver> (<build>)` on every call. The API answers **426 `APP_VERSION_UNSUPPORTED`** below `MOBILE_MIN_VERSION_IOS` / `MOBILE_MIN_VERSION_ANDROID`. `/v1` changes are additive only. A breaking change ships as `/v2` beside `/v1` for at least 90 days.                                            | The owner can force an update after a security fix, and old builds keep working through ordinary changes.                                                                                            | yes                                                    |
| M9  | The contract ships as **OpenAPI generated from the zod DTOs** in `packages/api-schema` (`packages/api-schema/openapi/mobile-v1.json`, committed and checked in CI). The app generates its types from it. The package is not published to npm.                                                                                                            | The app lives in another repo. A committed file is diffable and needs no registry.                                                                                                                   | yes                                                    |
| M10 | Universal links: `app.pickler.fun` paths `/agents/*`, `/tokens/*`, `/reads/*`, `/markets/*`, `/portfolio` open the app. `/api/*` and `/.well-known/*` never do. Android `assetlinks.json` names the same paths when Android ships.                                                                                                                       | Those are the marketplace's shareable objects. Answers research 05 open question 3.                                                                                                                  | yes                                                    |
| M11 | The AASA and `assetlinks.json` are served per host by route handlers, as `product-hosts-cutover-v2.md` H8 decides. This spec supplies only the `applinks` paths (M10) and the app ID.                                                                                                                                                                    | Workers Assets serves `public/` before the middleware runs (research 05 §3 gap 2). The cutover spec fixes that.                                                                                      | yes                                                    |
| M12 | The app's writes use the same `/v1/me/*` routes as the web. There are no mobile-only endpoints except device registration and the app config.                                                                                                                                                                                                            | One contract, tested once.                                                                                                                                                                           | yes                                                    |

## 3. User flows

### 3.1 First launch and sign-in

1. The app calls `GET /v1/marketplace/app-config`. If its version is below `minVersion`, it shows the
   blocking "Update Pickler" screen with the App Store link.
2. The person browses without an account (reading needs nothing, product-hosts-v1 §1).
3. On the first action that needs an account (buy, follow, portfolio), the app runs the Mera ceremony
   (`rpId: "app.pickler.fun"`), then `POST /v1/auth/wallet/nonce`
   `{ address, chain_id: 10143, wallet_kind: "mera", client: "ios" }`. It signs the returned `message`
   unchanged and calls `POST /v1/auth/wallet/verify`.
4. It stores `refreshToken` in the Keychain and hands the session to supabase-js.
5. It asks for notification permission **after** the first purchase or follow, never at launch. If
   permission is granted, it calls `POST /v1/me/devices` with the FCM token.

### 3.2 Session on the device

- supabase-js refreshes the access token before its hour runs out. A refresh that fails with
  `invalid_grant` (a revoked or 30-day-idle session, marketplace-wallets-v1 D13) sends the person
  back through step 3, keeping the action they were holding.
- Every API 401 triggers one refresh and one retry. A second 401 signs the person out locally.
- Sign out: `DELETE /v1/me/devices/:id`, then `supabase.auth.signOut()`, then clear the Keychain.

### 3.3 Buying a read

This follows `paid-reads-v1.md` §3 and §4.

1. `GET /v1/marketplace/agents/:handle/reads/quote` returns the price and a `quoteId` valid for 5
   minutes.
2. `POST /v1/me/reads` (with an `Idempotency-Key`) returns the payment intent: token, treasury,
   amount and expiry. `409 EMAIL_REQUIRED` shows the email field first.
3. The signing sheet (marketplace-wallets-v1 §3.6). The app builds `transfer(treasury, amount)` from
   the intent's fields and nothing else, then Mera `signTransaction`, then a broadcast to the Monad RPC.
4. `POST /v1/me/reads/:id/payment { txHash }`. The screen shows "Verifying payment" until `paid`.
5. Pushes arrive: delivered, or refunded (SLA missed), then evaluated at +24 h.

### 3.4 Trading an agent token

This follows `token-trading-v1.md` (T12). `POST /v1/me/trades/quote`, then the signing sheet (an
approval first when the quote has one), then sign and broadcast, then `POST /v1/me/trades`
`{ quoteId, txHash }`. The portfolio refreshes when the API confirms the trade.

### 3.5 Opening a universal link

`https://app.pickler.fun/agents/<handle>` opens the agent's screen in the app when the app is
installed, and the web page when it is not. The app maps the path to a screen and falls back to an
in-app browser for any path it does not know.

## 4. API

Base URL `https://app.pickler.fun/api/v1` (M1). Headers on every call: `X-Pickler-App` (M8), and
`Authorization: Bearer <access token>` where the Auth column asks for one. Envelope, pagination,
idempotency and money follow conventions.md.

**Prerequisite:** the `/v1/marketplace/*` routes answer bare JSON today (`marketplace.ts:27`,
`c.json(array)`). They move to the `{ data, meta }` envelope before the app's first public build. The
app codes against the envelope only.

### 4.1 Routes that exist (the app reads them as they are)

| Method | Path                                                             | Auth        | Purpose                                                                     | Source                         |
| ------ | ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- | ------------------------------ |
| POST   | `/auth/wallet/nonce`, `/auth/wallet/verify`, `/auth/wallet/link` | none / user | sign in, link (with `wallet_kind`, `client` from marketplace-wallets-v1 §4) | `routes/wallet-auth.ts:77-123` |
| GET    | `/auth/wallet/links`                                             | user        | the account's wallets                                                       | `wallet-auth.ts:125`           |
| GET    | `/marketplace/directory`, `/marketplace/agents`                  | none        | browse agents                                                               | `marketplace.ts:27-30`         |
| GET    | `/marketplace/personas/:handle`, `/marketplace/profiles/:ticker` | none        | agent page                                                                  | `marketplace.ts:36-47`         |
| GET    | `/marketplace/profiles/:ticker/picks/:id`                        | none        | a resolved pick                                                             | `marketplace.ts:40`            |
| GET    | `/marketplace/leaderboard`, `/marketplace/analytics`             | none        | leaderboard                                                                 | `marketplace.ts:53-56`         |
| GET    | `/marketplace/markets`, `/marketplace/markets/:symbol`           | none        | markets board (sample until Perpl is wired; labelled so)                    | `marketplace.ts:48-52`         |
| GET    | `/launches`, `/launches/:id`, `/launches/:id/trades`             | none        | tokens and their trades                                                     | `launches/routes.ts:21-47`     |
| GET    | `/handles/:handle/availability`, `GET/POST /profile`             | none / user | claim a handle                                                              | `routes/profiles.ts`           |

### 4.2 Routes the app needs that do not exist yet

The owning spec is named where another spec in this session owns the resource. This table is the
mobile contract: the owning spec may refine the fields, but must not remove any that is listed.

| Method         | Path                                                                 | Auth | Request                                                                 | Response `data`                                                                                                                                                                                                                                                  | Errors                                                                     | Owner                                                  |
| -------------- | -------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| GET            | `/marketplace/app-config`                                            | none | none                                                                    | `{ minVersion: { ios, android }, latestVersion: { ios, android }, siweDomain, chainId, meraRpId, features: Record<string, boolean> }`                                                                                                                            | none                                                                       | **this spec**                                          |
| GET            | `/marketplace/agents/:handle/reads/quote`                            | none | `?market=&level=`                                                       | the quote (`quoteId`, price, SLA, `expiresAt`)                                                                                                                                                                                                                   | 404, 409 `SERVICE_CLOSED`                                                  | `paid-reads-v1.md` §4.2                                |
| GET            | `/marketplace/reads`                                                 | none | `?agent=&market=&cursor=&limit=`                                        | public, resolved read cards                                                                                                                                                                                                                                      | —                                                                          | `paid-reads-v1.md` §4.2                                |
| POST           | `/me/reads`                                                          | user | `{ quoteId, handle, market, level?, context?, isPublic, payerAddress }` | the intent with `payment: { chainId, token, to, amountMicroAusd, expiresAt }`                                                                                                                                                                                    | 409 `EMAIL_REQUIRED`, `PAYER_NOT_LINKED`, `QUOTE_EXPIRED`, `PRICE_CHANGED` | `paid-reads-v1.md` §4.3                                |
| POST           | `/me/reads/:id/payment`                                              | user | `{ txHash }`                                                            | `{ state: "verifying" \| "paid" }`                                                                                                                                                                                                                               | 409 `TX_MISMATCH`, `TX_ALREADY_CLAIMED`                                    | `paid-reads-v1.md` §4.3                                |
| GET            | `/me/reads`, `/me/reads/:id`, `/me/reads/:id/receipt`                | user | `?state=&cursor=&limit=`                                                | the caller's reads and receipts                                                                                                                                                                                                                                  | 404                                                                        | `paid-reads-v1.md` §4.3                                |
| PUT            | `/me/notify-email`                                                   | user | `{ email }`                                                             | `{ email, verified }`                                                                                                                                                                                                                                            | 400 `INVALID_EMAIL`                                                        | `paid-reads-v1.md` §4.3                                |
| POST           | `/me/trades/quote`, `/me/trades`; GET `/me/trades`, `/me/trades/:id` | user | as `token-trading-v1.md` §4                                             | the quote with `tx` (and `approval`), then `TradeDto`                                                                                                                                                                                                            | 403 `WALLET_NOT_LINKED`, 409 `INSUFFICIENT_GAS`, 409 `TX_MISMATCH`         | `token-trading-v1.md`                                  |
| GET            | `/me/portfolio`                                                      | user | none                                                                    | `{ wallets: [{ address, kind, label, balances: { monWei, ausdMicro }, tokens: [{ launchId, ticker, amount, valueMicroAusd }] }], reads: { inWindow, awaiting, spentMicroAusd, refundedMicroAusd } }`; `token-trading-v1.md` extends each token and adds `trades` | 503 `CHAIN_UNAVAILABLE` (balances then `null`, never 0)                    | shape: **this spec**; built with `token-trading-v1.md` |
| GET/PUT/DELETE | `/me/follows`, `/me/follows/:handle`; POST `/me/follows/import`      | user | as `public-record-v1.md` §4                                             | follows                                                                                                                                                                                                                                                          | 404 `AGENT_NOT_FOUND`, 409 `FOLLOW_LIMIT`                                  | `public-record-v1.md`                                  |
| GET            | `/me/notifications`                                                  | user | `?cursor=&limit=&unread=true`                                           | `[{ id, type, title, body, link, createdAt, readAt }]`, `meta.unreadCount`                                                                                                                                                                                       |                                                                            | **this spec**                                          |
| POST           | `/me/notifications/read`                                             | user | `{ ids: string[] } \| { upTo: string }`                                 | `{ updated }`                                                                                                                                                                                                                                                    |                                                                            | **this spec**                                          |
| GET            | `/me/notification-preferences`                                       | user | none                                                                    | `{ push: Record<NotificationType, boolean>, email: Record<NotificationType, boolean> }`                                                                                                                                                                          |                                                                            | **this spec**                                          |
| PUT            | `/me/notification-preferences`                                       | user | the same shape, partial                                                 | the same                                                                                                                                                                                                                                                         | 400                                                                        | **this spec**                                          |
| POST           | `/me/devices`                                                        | user | `{ platform: "ios" \| "android", pushToken, appVersion, locale }`       | `{ id }` (upsert by `pushToken`)                                                                                                                                                                                                                                 | 400                                                                        | **this spec**                                          |
| DELETE         | `/me/devices/:id`                                                    | user | none                                                                    | `{ removed: true }`                                                                                                                                                                                                                                              | 404                                                                        | **this spec**                                          |

**Notification types v1** (`NotificationType`): `read_delivered`, `read_refunded`, `read_evaluated`,
`trade_confirmed`, `trade_failed`, `followed_agent_pick_resolved` (a followed agent's decision became
public on resolution, conventions decision 1), `followed_agent_token_launched`. Defaults: push on for
all except `followed_agent_pick_resolved` (inbox only). Email is on for the three read types when the
profile has an email.

## 5. Data model and migrations

One migration, **`mobile_notifications_and_devices`** (number assigned at build time; the next free
number is 0023). It creates a new product schema **`me`** (the marketplace account's own state), kept
out of the Supabase Data API like the others (root AGENTS.md):

- `me.devices (id uuid pk, user_id uuid not null, platform text check in ('ios','android'), push_token text not null unique, app_version text not null, locale text, created_at, last_seen_at, disabled_at timestamptz null)`. A token that FCM reports as `UNREGISTERED` gets `disabled_at` and is never used again.
- `me.notifications (id uuid pk, user_id uuid not null, type text not null, subject_id text not null, title text not null, body text not null, link text not null, created_at, read_at timestamptz null, pushed_at timestamptz null)`, unique `(user_id, type, subject_id)` so a retried producer never notifies twice, index `(user_id, created_at desc)`.
- `me.notification_preferences (user_id uuid pk, push jsonb not null, email jsonb not null, updated_at)`. A missing row means the defaults.

Follows are not in this migration: `public-record-v1.md` owns their table. The notification producer
for `followed_agent_*` types reads it.

**Producers.** The `paid-reads-v1.md` and `token-trading-v1.md` jobs, and the `public-record-v1.md` publication, insert notifications through a core use case
`notify(userId, type, subjectId, …)`. It writes the row and enqueues `{ notificationId }` on the new
Queue **`pickler-notifications`**. The API worker gains a `queue` handler that loads the row, checks
the preferences, sends to each live device through `PushSender`, and sets `pushed_at`.

## 6. Integrations

| System                      | Use                                | Config                                                                                                                                                        |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Cloud Messaging v1 | push to iOS (via APNs) and Android | secrets `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON` on `workers/api`. The APNs `.p8` key is uploaded to Firebase by the owner                                |
| Cloudflare Queues           | `pickler-notifications`            | producer and consumer bindings on `workers/api` (`wrangler.jsonc`, `wrangler.staging.jsonc`), `max_retries: 5`, dead-letter queue `pickler-notifications-dlq` |
| Supabase Auth               | refresh on the device              | the project URL and anon key in the app's build config (public). Rotation and 30-day inactivity per marketplace-wallets-v1 D13                                |
| Apple                       | Associated Domains                 | the AASA route (M11) serving `webcredentials.apps` and `applinks.details[{ appIDs: ["2PBQJ37Q8W.fun.pickler.app"], components: M10 paths }]`                  |
| Google (later)              | Android App Links                  | `assetlinks.json` with the release key's SHA-256 fingerprint (owner question)                                                                                 |
| API                         | version gate                       | vars `MOBILE_MIN_VERSION_IOS`, `MOBILE_MIN_VERSION_ANDROID`, `MOBILE_LATEST_VERSION_IOS`, `MOBILE_LATEST_VERSION_ANDROID`                                     |

### 6.1 What the app must change (product-hosts-v1 §4)

| In the app                           | From (believed)                  | To                                                                        |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------- |
| Associated Domains `webcredentials:` | `webcredentials:pickler.fun`     | `webcredentials:app.pickler.fun`                                          |
| Associated Domains `applinks:`       | absent or `applinks:pickler.fun` | `applinks:app.pickler.fun`                                                |
| Mera `rpId`                          | `pickler.fun`                    | `app.pickler.fun`                                                         |
| SIWE `domain`                        | whatever the app builds          | none: the app signs the server's message and builds no message of its own |
| API base URL                         | `pickler.fun/api/v1` (probably)  | `https://app.pickler.fun/api/v1`                                          |

Plus: send `X-Pickler-App`, store the refresh token in the Keychain, register the device for push,
and handle 426.

## 7. Design work

All of these are **mobile** screens. The design project's mobile flows canvas exists and is out of
scope in design-system-v2 §8. It must be extended with the frames below.

| Screen                             | States                                                                         | Canvas                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Update required                    | blocking, with the App Store link                                              | **draw**, in the mobile flows canvas                                   |
| Sign in with Mera                  | create, restore, PRF unavailable, cancelled, network error                     | extend the mobile flows canvas (shared with marketplace-wallets-v1 §7) |
| Signing sheet (native)             | sign in, pay for a read, trade; needs MON; sent; confirmed; failed             | **draw**, as the native counterpart of "Pickler Signing Sheet"         |
| Notification permission pre-prompt | after the first purchase or follow                                             | **draw**                                                               |
| Inbox                              | empty, unread, read, a row per type, deep link                                 | **draw**                                                               |
| Notification settings              | push and email toggles per type, email missing                                 | **draw**                                                               |
| Following                          | empty, list, unfollow                                                          | **draw**                                                               |
| Portfolio                          | one wallet, several wallets, balances unknown (never 0), reads summary, tokens | adapt `Portfolio Light` (web canvas) to mobile                         |

The web gets two screens from this spec: **Following** in the marketplace account sheet, and the
**inbox** (a bell in the marketplace nav) on the marketplace web light surface. Both need to be drawn
in the same session as the Wallets section (marketplace-wallets-v1 §7).

## 8. Security and abuse

- **Tokens on the device.** The refresh token is kept in the Keychain, never in AsyncStorage. The
  access token lives only in memory. The app pins nothing (Cloudflare rotates certificates), and it
  uses ATS defaults.
- **Rate limits.** Per IP (M2) on every unauthenticated route (120/min), and per user on writes (60/min;
  quotes 20/min). The response is 429 with `retryAt`.
- **Device hijack.** `POST /me/devices` upserts by push token and moves the token to the calling user,
  so a reinstalled app never notifies the previous account. `DELETE` happens on sign-out.
- **Push content.** No amounts, addresses or question text on the lock screen. The title says "Your
  read from @handle is ready", and the details load in the app after auth.
- **Deep links.** The app treats every universal-link path as untrusted input, and never starts a
  signature from a link without the signing sheet.
- **Forced update.** The 426 gate is checked by a middleware before auth, so an unsupported build
  cannot sign in.
- **Mera on the phone.** The 5-minute session (M4) is cleared on `AppState` background and on sign-out.

## 9. Acceptance criteria and tests

1. The OpenAPI file regenerates identically in CI (`npm run check:openapi`, new) and covers every
   route in §4.
2. API tests: the 426 gate for old, missing and malformed `X-Pickler-App` values (a missing header
   is allowed, because browsers send none); the
   device upsert moves a token between users; notifications are unique per `(user, type, subject)`.
3. The queue consumer sends through a fake `PushSender`, honours preferences, and disables a token on
   `UNREGISTERED`.
4. The AASA route answers on the marketplace host only and 404s on the studio and the landing. A
   test parses it and asserts that `webcredentials.apps` and `applinks.details[].appIDs` name the
   same app (product-hosts-v1 §9).
5. **Manual, on staging with a TestFlight build pointed at it:** sign in with Mera, kill the app, reopen
   it after the access token has expired and stay signed in, follow an agent on the phone and see it
   on the web, receive a test push, and open `app.pickler.fun/agents/<handle>` from Notes into the
   app. Recorded in a dated doc.

## 10. Rollout and dependencies

1. **Needs first:** `product-hosts-cutover-v2.md` (DNS for `app.`, the AASA route handlers),
   marketplace-wallets-v1 (the `wallet_kind` and `client` fields), and the envelope move of
   `/v1/marketplace/*`.
2. Then: app-config, the version gate, devices and notifications (this spec), and follows
   (`public-record-v1.md`).
3. Reads and trades arrive with `paid-reads-v1.md` and `token-trading-v1.md`, the portfolio with
   `token-trading-v1.md`. The app hides Buy and Trade
   behind `features.reads` / `features.trading` from app-config until then.

### 10.3 What to verify when the app's source arrives

1. The key model: PRF (`getPasskeyPrfOutput`) or vault. If it is the vault model,
   marketplace-wallets-v1 D2 breaks and the owner decides.
2. The four host values in §6.1, and whether the app builds a SIWE message itself (it must not).
3. The base URL the app calls today, and every path it calls. Diff them against §4.
4. Expo or bare React Native. That decides whether FCM or Expo Push is simpler (M5).
5. How it stores the session today (AsyncStorage would be a finding).
6. Whether it trades on Perpl today, as `docs/market/token-launch.md` says. Perpl trading from the
   phone is not in this spec.
7. Its bundle ID and team (`2PBQJ37Q8W.fun.pickler.app`) against the AASA.

## 11. Out of scope

Perpl trading from the phone; an EOA or WalletConnect on the phone; Android release (the contract
covers it, the store work does not); in-app purchase; email delivery (`paid-reads-v1.md` owns the
email); an API host of its own; offline mode.

## 12. Open questions for the owner

1. **Where is the app's source, and who owns it?** Nothing in §10.3 can be checked without it.
2. **The Firebase project.** Is there one for Pickler, and can the APNs key (`.p8`, team `2PBQJ37Q8W`)
   be uploaded to it? If you would rather not use Google, the fallback is direct APNs through a
   small non-Worker relay.
3. **The Android release key's SHA-256**, for `assetlinks.json`, when Android is planned.

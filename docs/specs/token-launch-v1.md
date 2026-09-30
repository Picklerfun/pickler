# Token launch v1: an owner launches their agent's token from the studio

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(products and wallets rule; decision 5). Stands on `launchpad-deploy-v1.md` (the grant-gated
factory, `launch.agent_keys`, `launch.grants`, the outbox consumer) and `go-public-v1.md` (the
`visibility = 'public'` gate). This spec also owns **media storage** for the whole product (§6.1),
which `go-public-v1.md` uses for avatars. Buying and selling are in `token-trading-v1.md`. Every decision below
is reversible until a token is launched; a launched token is permanent on chain.

## 1. Problem and users

**User:** a studio account (Turnkey master wallet, passkey root) that owns a public agent and wants
the agent to have a token people can back on the marketplace.

Today nobody can create a token from the product (`docs/product-map/research/03-launchpad.md` §3):

- The studio's Token section is a "Soon" panel (`apps/web/src/features/studio/sections/rail.ts:51`,
  copy at `:101-105`).
- The `launch.*` tables exist with the full draft state enum
  (`packages/infrastructure/drizzle/0015_reflective_sunset_bain.sql:3`) but nothing writes
  `launch.drafts`, `launch.metadata_versions` or `launch.transaction_requests`
  (`packages/infrastructure/src/persistence/product/launch.ts:99-159`).
- `launch.metadata_versions.token` is `NOT NULL` (`0015_reflective_sunset_bain.sql:28`), so metadata
  cannot be recorded before the token address exists, which is exactly when the factory needs its
  hash.
- Nothing builds a `createLaunch` transaction for the master wallet the way the deposit flow builds
  a transfer (`packages/infrastructure/src/chain/deposit-tx.ts:317`,
  `workers/api/src/routes/studio.ts:583-620`).
- There is no image storage for token art, and no way to see what the launch did afterwards.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                       | Reason                                                                                                                                                                                             | Reversible?                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T1  | **Eligibility**: the caller owns the agent; the agent is `visibility = 'public'` (`go-public-v1.md` D1); it has no launched token on this chain; the launchpad is deployed on the chain (`PICKLER_LAUNCHPAD[chainId]` exists) and `launchesEnabled()` is true.                                                 | Conventions decision 5: public agent, once. The same checks are re-run by the grant (`launchpad-deploy-v1.md` §4), so the studio never decides alone.                                              | Yes.                                                                                 |
| T2  | **One draft per agent per chain**, stored in `launch.drafts` with `agent_id` set; states `draft → validated → prepared → submitted → launched`, or `abandoned`. A revert or a dropped transaction goes `submitted → validated`; an expired grant goes `prepared → validated`.                                  | The enum exists; the backward edges keep the reserved ticker and pinned metadata so a retry is one click.                                                                                          | Yes.                                                                                 |
| T3  | **Creator and creator fee recipient are the owner's master wallet.** The master wallet calls `createLaunch` directly (`launchpad-deploy-v1.md` D4), signed by the passkey through the prepare/stamp/submit pattern of deposits.                                                                                | The studio's only wallet is Turnkey (products and wallets rule); one passkey prompt.                                                                                                               | Yes (the fee recipient can move later on chain, `PicklerLaunchFactory.sol:203-227`). |
| T4  | **Metadata**: name (1–40 chars, `market.ts:88`), ticker (`$` + `^[A-Z][A-Z0-9]{1,5}$`, `market.ts:87`, and the factory's symbol rule, `launchpad-deploy-v1.md` D5), description (≤ 280 chars), image (required).                                                                                               | Matches the columns and checks that already exist; the ticker rule is the same on chain and off.                                                                                                   | Yes.                                                                                 |
| T5  | **Images and metadata JSON live in the shared media store defined in §6.1** (R2 binding `MEDIA`), under `tokens/` and `metadata/`, served from `MEDIA_PUBLIC_BASE_URL` (`https://media.pickler.fun` in production). Images are content-addressed `tokens/<sha256>.webp`; metadata `metadata/<keccak256>.json`. | One bucket and one domain for all public media; content addressing makes the URI immutable, which the on-chain hash requires. Avatars (`go-public-v1.md` D18) use the same store under `avatars/`. | Yes; IPFS pinning can be added as a second URI in v2.                                |
| T6  | **Image rules**: PNG, JPEG or WebP upload ≤ 1 MiB, square (±2%), ≥ 256 px; re-encoded server-side to 512×512 WebP, EXIF stripped. The stored bytes, not the upload, are hashed.                                                                                                                                | Same rules as avatars (`go-public-v1.md` D18); re-encoding removes payloads and metadata.                                                                                                          | Yes.                                                                                 |
| T7  | **`metadataHash = keccak256(metadata JSON bytes)`**, JSON canonicalised (sorted keys, no whitespace): `{ "name", "symbol", "description", "image", "agent": "https://app.pickler.fun/agents/<handle>", "schema": "pickler.token.v1" }`.                                                                        | The factory commits to the hash (`PicklerLaunchFactory.sol:37`); a viewer can recompute it from the URI.                                                                                           | Yes before launch.                                                                   |
| T8  | **The ticker is reserved at validate**, not before: validate inserts `market.tokens (agent_id, ticker, name, chain, status 'reserved')`. Abandoning or 7 days in `validated` without a submit sets that row to `failed`, which frees the ticker (`market.ts:76-82`).                                           | A ticker is scarce; holding it for an owner who never launches blocks others.                                                                                                                      | Yes (the TTL is a constant).                                                         |
| T9  | **Presets**: v1 shows exactly one preset, `1/1`, read from `launch.presets`, which the indexer mirrors from `PresetPublished`. No choice is offered; the review sheet shows its numbers.                                                                                                                       | One set of economics until the owner approves more (`launchpad-deploy-v1.md` §12 Q2).                                                                                                              | Yes (a picker when a second preset exists).                                          |
| T10 | **Launch fee**: charged by the factory in AUSD when the preset's `launchFee > 0` (`launchpad-deploy-v1.md` D6). The prepare then returns two activities: an `approve(factory, launchFee)` for exactly the fee, then `createLaunch`. On testnet the fee is 0 and there is one activity.                         | Never an unlimited approval from the master wallet.                                                                                                                                                | Yes.                                                                                 |
| T11 | **"Launched" means the indexer saw `LaunchCreated` at the configured confirmations**, delivered through the outbox consumer (`launchpad-deploy-v1.md` D15). A receipt alone moves the UI to "Confirming", never to "Launched".                                                                                 | A hash is not a launch; a receipt can be reorged.                                                                                                                                                  | Yes.                                                                                 |
| T12 | **No initial buy in v1.** The owner can buy their own token afterwards on the marketplace like anyone else, with a marketplace wallet.                                                                                                                                                                         | Keeps the launch one transaction and the studio free of trading; the master wallet never trades (products and wallets rule).                                                                       | Yes.                                                                                 |
| T13 | **Creator fees are claimed from the studio**: `FeeEscrow.claim(AUSD, masterWallet)` (`contracts/src/PicklerFeeEscrow.sol:130`), signed by the passkey, from the Token section.                                                                                                                                 | The fee recipient is the master wallet, so only the studio can claim.                                                                                                                              | Yes.                                                                                 |
| T14 | **Metadata is frozen after launch in v1.** No image or description edits.                                                                                                                                                                                                                                      | The factory commits a hash once; `metadata_versions` supports history, but serving a version the chain never committed needs its own rules (§12 Q2).                                               | Yes.                                                                                 |

## 3. User flows

### 3.1 Launch

1. The owner opens **Token** in the studio rail. `GET /v1/studio/agents/:id/token` answers the
   eligibility (T1). Not eligible → an empty state names the one blocker (not public → "Go public
   first" linking to Go Public; paused; not deployed; already launched → the launched view).
2. **Draft form**: name (defaults to the agent's name), ticker (defaults to the first letters of the
   handle, uppercased), description (defaults to the agent's blurb), image (defaults to the avatar if
   there is one, re-uploaded as token art). A live preview card on the right renders the token as the
   marketplace board will. Each change is a `PUT .../token/draft` with the draft's `version`
   (optimistic concurrency, `launch.ts:113-114`). Ticker availability is checked inline.
3. **Continue** → `POST .../token/validate`: the API re-checks eligibility, reserves the ticker,
   writes the metadata JSON to R2, records the metadata version against the draft, and moves the
   draft to `validated`.
4. **Review sheet**: preset numbers (total supply, sale and LP allocation, starting and graduation
   price in AUSD, graduation target in AUSD, buy and sell fee, creator and protocol share, LP fee
   tier), "The liquidity is locked forever at graduation. Nobody, including Pickler, can withdraw
   it.", "You cannot change the name, ticker or image after launch.", the launch fee (or "No launch
   fee on testnet"), the estimated gas in MON, and the network label ("Monad testnet").
5. **Launch with passkey** → `POST .../token/prepare` (with `Idempotency-Key`): the API obtains a
   grant (`launchpad-deploy-v1.md` §4), builds the unsigned `SIGN_TRANSACTION_V2` activity (or two,
   T10) from the master wallet, stores a `launch.transaction_requests` row per activity and moves the
   draft to `prepared`. A failed gas estimate answers `409 LAUNCH_NOT_SENDABLE` before any prompt
   (usually too little MON in the master wallet).
6. The browser stamps each activity with the passkey (one prompt per activity).
7. `POST .../token/submit { signed }`: the API inspects and byte-compares (§8), forwards to Turnkey,
   broadcasts, records the hash, moves the draft to `submitted`.
8. **Pending**: the screen polls `GET .../token/status` every 2 s: "Sent" (hash, explorer link) →
   "Confirming" (receipt seen, `n / CONFIRMATIONS`) → "Launched" (outbox delivered).
9. **Launched view** (§7).

### 3.2 Failure and retry

- **Reverted**: the receipt shows `status 0`; the API decodes the revert (`InvalidGrant`,
  `GrantExpired`, `AgentAlreadyLaunched`, `LaunchesSuspended`, `ConfigChanged`, `InvalidSymbol`),
  marks the request `reverted`, moves the draft back to `validated` and shows the reason with
  "Try again" (a new prepare with a new grant).
- **Not mined within 10 minutes**: the request stays `submitted`; the status reports "Still waiting";
  the owner can "Try again", which prepares with the **same nonce** and fees at least 12.5% higher,
  so the chain keeps one of the two (the replaced one is marked `replaced`,
  `0015_reflective_sunset_bain.sql:5`).
- **Grant expired before stamping**: submit answers `409 GRANT_EXPIRED`; the draft is back at
  `validated` and the screen re-prepares with one tap.
- **Abandon**: `POST .../token/abandon` from `draft` or `validated` frees the ticker (T8); refused
  from `prepared` or `submitted` with `409 LAUNCH_IN_FLIGHT`.

### 3.3 Claim creator fees

On the launched view, "Fees earned" reads `claimable(masterWallet, AUSD)` from the escrow. "Claim"
→ `POST .../token/fees/claim/prepare` → passkey → `POST .../token/fees/claim/submit`; the claimed
amount lands in the master wallet and the tile resets once the indexer sees `FeeClaimed`.

## 4. API

All under `/v1/studio/agents/:id/token`, auth a studio Supabase JWT, owner only; an agent of another owner answers 404
`AGENT_NOT_FOUND`, never 403 (cross-review C21). DTOs in `packages/api-schema/src/launches.ts` (decision): `TokenSectionDto`,
`TokenDraftDto`, `TokenDraftInput`, `LaunchPrepareDto`, `LaunchStatusDto`, `FeeClaimPrepareDto`.

| Method | Path                           | Request                                                  | Response                                                                                                                                                                                          | Errors                                                                                                                                         |
| ------ | ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                            | —                                                        | `{ eligibility: { eligible, blocker? }, draft: TokenDraftDto \| null, launch: { token, curve, ticker, status, launchedAt, txHash, feesClaimableMicroAusd } \| null, preset: PresetDto, network }` | 503 `LAUNCHPAD_NOT_DEPLOYED`                                                                                                                   |
| PUT    | `/draft`                       | `{ version?, name, ticker, description, imageUploadId }` | `TokenDraftDto` (`status: "draft"`)                                                                                                                                                               | 400 `INVALID_TOKEN_DRAFT` (`detail.fields`), 409 `DRAFT_VERSION_CONFLICT`, 409 `DRAFT_LOCKED` (not in `draft`/`validated`), 409 `TICKER_TAKEN` |
| GET    | `/ticker-availability?ticker=` | —                                                        | `{ available, reason? }` (`taken`, `reserved`, `format`)                                                                                                                                          | 400                                                                                                                                            |
| POST   | `/image`                       | header `Idempotency-Key`; `multipart/form-data` `file`   | `{ imageUploadId, url }`                                                                                                                                                                          | 400 `INVALID_IMAGE`, 413 `IMAGE_TOO_LARGE`                                                                                                     |
| POST   | `/validate`                    | header `Idempotency-Key`; `{ version }`                  | `TokenDraftDto` (`status: "validated"`, `metadataUri`, `metadataHash`)                                                                                                                            | 403 `LAUNCH_NOT_ELIGIBLE` (`detail.blocker`), 409 `TICKER_TAKEN`, 409 `DRAFT_VERSION_CONFLICT`                                                 |
| POST   | `/prepare`                     | header `Idempotency-Key`; `{ version }`                  | `{ requests: [{ id, kind: "approve" \| "create_launch", activity }], grantDeadline, gasEstimateMon }`                                                                                             | 403 `LAUNCH_NOT_ELIGIBLE`, 409 `LAUNCH_NOT_SENDABLE`, 409 `LAUNCHES_PAUSED`, 409 `DRAFT_NOT_VALIDATED`                                         |
| POST   | `/submit`                      | header `Idempotency-Key`; `{ requestId, signed }`        | `LaunchStatusDto`                                                                                                                                                                                 | 400 `SIGNED_TRANSACTION_MISMATCH`, 409 `GRANT_EXPIRED`, 409 `LAUNCH_ALREADY_SUBMITTED` (answers the recorded hash, never rebroadcasts)         |
| GET    | `/status`                      | —                                                        | `{ draftStatus, request: { status, txHash, confirmations, required, failureReason? } }`                                                                                                           | 404 `NO_LAUNCH_IN_FLIGHT`                                                                                                                      |
| POST   | `/abandon`                     | `{ version }`                                            | `{ draftStatus: "abandoned" }`                                                                                                                                                                    | 409 `LAUNCH_IN_FLIGHT`                                                                                                                         |
| POST   | `/fees/claim/prepare`          | header `Idempotency-Key`                                 | `{ requestId, activity, amountMicroAusd }`                                                                                                                                                        | 409 `NOTHING_TO_CLAIM`, 409 `CLAIM_NOT_SENDABLE`                                                                                               |
| POST   | `/fees/claim/submit`           | `{ requestId, signed }`                                  | `{ txHash }`                                                                                                                                                                                      | 400 `SIGNED_TRANSACTION_MISMATCH`                                                                                                              |

Use cases in `packages/core/src/features/launch` (decision): `getTokenSection`, `saveTokenDraft`,
`validateTokenDraft`, `prepareLaunch`, `submitLaunch`, `readLaunchStatus`, `abandonLaunch`,
`prepareFeeClaim`, `submitFeeClaim`; ports `LaunchDraftStore`, `MediaStore`, `LaunchGrantSigner`,
`LaunchTransactionBuilder` (infrastructure beside `deposit-tx.ts`). The grant is obtained in-process
through `LaunchGrantSigner`; `/v1/internal/launch/grants` (`launchpad-deploy-v1.md` §4) is its
service-binding form.

**Status reconciliation**: a `workers/jobs` Cron every minute (conventions decision 15; the API has
no crons) calls `POST /v1/internal/launch/reconcile` through its service binding, and each
`GET /status` does the same work inline; it reads
receipts for `submitted` requests: receipt `status 1` → request `included`; `status 0` → `reverted`
and draft back to `validated`; outbox `token.launched` for the draft's `agent_key` → request
`finalized`, draft `launched`, `launched_token` set, `launch.grants.consumed_tx` set, the reserved
`market.tokens` row replaced by the projected one (the projector finds it by `agent_id`, since
`tokens_agent_key` allows one non-failed row, `market.ts:77-79`). The same job expires ticker
reservations past `reserved_until` (T8).

## 5. Data model and migrations

### Migration `media_store` (number assigned at build time; phase 1, no launchpad dependency)

Creates the `media` schema and the `media.uploads` and `media.takedowns` tables of §6.1. It ships
in its own PR with the media store, before Go Public's avatars and independently of the launchpad
(cross-review C8, W5).

### Migration `token_launch_drafts` (number assigned at build time; after `launchpad_attribution` and `media_store`)

- `launch.drafts`: `ADD COLUMN name text`, `ticker text`, `description text`, `image_key text`
  (validated shape lives in `params` today, `launch.ts:111`; the columns make the unique rules
  below expressible), `ADD COLUMN reserved_until timestamptz`, and
  `CREATE UNIQUE INDEX drafts_agent_chain_live ON launch.drafts (agent_id, chain) WHERE status NOT
IN ('abandoned')` — one live draft per agent per chain (T2).
- `launch.metadata_versions`: `ALTER COLUMN token DROP NOT NULL`, `ADD COLUMN draft_id uuid
REFERENCES launch.drafts(id) ON DELETE SET NULL`, `ADD CONSTRAINT metadata_versions_subject CHECK
(token IS NOT NULL OR draft_id IS NOT NULL)`, `CREATE UNIQUE INDEX metadata_versions_draft_hash
ON launch.metadata_versions (draft_id, content_hash) WHERE draft_id IS NOT NULL`. The token column
  is filled when the launch is projected; the existing `(chain, token, content_hash)` unique index
  keeps working for rows with a token.
- `launch.transaction_requests`: `ADD COLUMN draft_id uuid REFERENCES launch.drafts(id)`, `ADD
COLUMN kind text CHECK (kind IN ('approve', 'create_launch', 'fee_claim'))`, `ADD COLUMN
nonce bigint`, `ADD COLUMN unsigned_activity jsonb` (the exact body the stamp is compared with),
  `ADD COLUMN replaces uuid REFERENCES launch.transaction_requests(id)`.
- Nothing for media: `imageUploadId` names a `media.uploads` row (migration `media_store`) with
  `purpose = 'token_image'`.
- RLS on, `service_role` grants, as `0016_launch_grants.sql`.

Not in this migration (owned by `launchpad-deploy-v1.md`'s `launchpad_attribution`):
`launch.agent_keys`, `launch.grants`, `market.tokens.agent_key/metadata_uri/description`.

## 6. Integrations

- **Factory** `createLaunch(params, creatorAuthorization = 0x, grantNonce, grantDeadline, grant)`
  (`launchpad-deploy-v1.md` §6.1). `params.agentKey` from D2 there, written to `launch.agent_keys`
  at validate.
- **Turnkey**: `SIGN_TRANSACTION_V2` from the master wallet, stamped in the browser; forwarded with
  the same client the deposit uses. The passkey is the sub-organization's root.
- **Monad RPC**: nonce, fee quote (`deposit-tx.ts:90,107`), gas estimate, receipts, `claimable`,
  `launchesEnabled`.
- **Media storage**: the shared store of §6.1 (`MEDIA`, `IMAGES`, `MEDIA_PUBLIC_BASE_URL`).
- **Env** (`workers/api`): `LAUNCH_MAX_GAS` (default 3 000 000; `createLaunch` deploys a token and
  a curve), `LAUNCH_TICKER_RESERVATION_DAYS` (7), plus the shared `CHAIN_ID` and `MONAD_RPC_URL` of
  `production-environment-v1.md` (no launch-specific chain variable, cross-review C22), and the
  `LAUNCH_AUTHORITY_*` vars of `launchpad-deploy-v1.md` §6.3.

### 6.1 Media storage (shared by the whole product)

No other spec owns public files; this section is the single definition. `go-public-v1.md` (avatars)
and any later spec that stores a public image reference it rather than redefining it.

| Item             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store            | One Cloudflare R2 bucket per environment: `pickler-media-staging` and `pickler-media-production`, bound to `workers/api` only, as `MEDIA`. No other Worker writes to it; the web app never holds R2 credentials.                                                                                                                                                                                                                                                                                                                                                                         |
| Public URLs      | R2 custom domains: `https://media-staging.pickler.fun` and `https://media.pickler.fun` (`MEDIA_PUBLIC_BASE_URL`). A URL is `<base>/<prefix>/<sha256>.<ext>`. Objects are served with `Cache-Control: public, max-age=31536000, immutable`, the stored content type and `X-Content-Type-Options: nosniff`. Listing is off.                                                                                                                                                                                                                                                                |
| Key prefixes     | `tokens/` (token images, `<sha256>.webp`), `avatars/` (agent avatars, `<sha256>.webp`), `metadata/` (token metadata JSON, `<keccak256>.json`, hashed over the exact bytes stored). New prefixes are added here, not by the using spec.                                                                                                                                                                                                                                                                                                                                                   |
| Upload           | Through the API only, never a presigned direct-to-R2 URL in v1: an authenticated `multipart/form-data` POST on the owning route (`POST /v1/studio/agents/:id/token/image`, `POST /v1/studio/agents/:id/avatar`). The API checks the caller owns the agent, sniffs magic bytes (the declared type is ignored), re-encodes, hashes the stored bytes and writes the object and a `media.uploads` row in that order. An identical hash reuses the object.                                                                                                                                    |
| Limits           | PNG, JPEG or WebP input (no SVG, GIF or animation); ≤ `MEDIA_UPLOAD_MAX_BYTES` (1 MiB); ≤ 4096 px on each side; square within ±2 %; ≥ 256 px. Output: 512×512 WebP, metadata (EXIF, ICC, XMP) stripped. Metadata JSON ≤ 8 KiB, written only by the API.                                                                                                                                                                                                                                                                                                                                  |
| Re-encoding      | Cloudflare Images binding `IMAGES` (transform to WebP 512×512). If the binding is absent the route answers 503 `MEDIA_UNAVAILABLE` rather than storing an unprocessed upload.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Rate limits      | `MEDIA_UPLOADS_PER_HOUR` (30) per studio account, 429 with `retryAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Lifecycle        | An upload not referenced within 24 h (by a draft, a token, or an agent's `avatar_key`) is deleted with its object by a daily sweeper in `workers/ops` (conventions decision 15), through an internal API route. Referenced objects are never overwritten (content addressing), so a token's on-chain `metadataHash` keeps matching.                                                                                                                                                                                                                                                      |
| Moderation       | Uploads are visible publicly only once referenced by something public (a validated launch draft, a public agent). Cloudflare's CSAM Scanning Tool is enabled on both media domains. Takedown: `POST /v1/internal/media/takedowns` (operator, service binding) deletes the object, writes `media.takedowns` and `audit.events`; readers then render the monogram or a placeholder, and a taken-down hash can never be uploaded again. Until a report route exists, users report an image by email and the operator is alerted through `operations-v1.md` O4 (cross-review W8).            |
| Tables           | `media.uploads (id uuid pk, owner_id uuid NOT NULL REFERENCES identity.profiles(user_id), purpose text CHECK (purpose IN ('token_image','avatar')), object_key text NOT NULL UNIQUE, sha256 text NOT NULL, content_type text NOT NULL, bytes int NOT NULL, width int, height int, created_at timestamptz NOT NULL DEFAULT now())`; `media.takedowns (sha256 text pk, object_key text, reason text NOT NULL, actor text NOT NULL, created_at timestamptz)`. New `media` schema, RLS on, `service_role` only, never exposed through the Data API. Created by migration `media_store` (§5). |
| Ports            | `MediaStore` in `packages/core` (`put`, `delete`, `publicUrl`); `R2MediaStore` in `packages/infrastructure`; composed in `workers/api/src/container.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Env and bindings | `MEDIA` (R2), `IMAGES` (Images), `MEDIA_PUBLIC_BASE_URL`, `MEDIA_UPLOAD_MAX_BYTES`, `MEDIA_UPLOADS_PER_HOUR`, in `workers/api` staging and production configs; `scripts/check-staging.mjs` asserts the binding and the base URL are present.                                                                                                                                                                                                                                                                                                                                             |

## 7. Design work

Surface: **studio web** only (`studio.pickler.fun`). The **studio Token section canvas must be
drawn**; none exists (the section renders the shared Soon panel). Screens and states on it:

| Screen               | States                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token — not eligible | private agent ("Go public first"), launches paused, launchpad not deployed on this network (the two states `launchpad-deploy-v1.md` §7 asks for)                                                                                                                 |
| Token — draft form   | empty, filled, field errors, ticker taken, image uploading / rejected; live preview card (the marketplace board card at its real size)                                                                                                                           |
| Token — review sheet | fee / no fee, gas estimate, "not sendable" (no MON), paused mid-review                                                                                                                                                                                           |
| Token — passkey step | waiting for passkey (1 of 1 or 1 of 2), cancelled, grant expired                                                                                                                                                                                                 |
| Token — pending      | sent, confirming n/N, still waiting (with Try again), reverted with reason                                                                                                                                                                                       |
| Token — launched     | token card (image, name, ticker, price, market cap, holders, stage: curve progress to graduation / graduated), "View on marketplace" → `https://app.pickler.fun/tokens/<ticker>`, explorer link, Fees earned + Claim (idle, claiming, claimed, nothing to claim) |

The rail item `token` drops `soon: true` (`rail.ts:51`) and its Soon copy (`rail.ts:101-105`) is
removed. No marketplace or mobile design work comes from this spec.

## 8. Security and abuse

- **Signed-body check** at submit, as deposits (`studio-create-and-fund-v1.md` §6.2): chain 10143;
  `to` = the manifest's factory (or AUSD for the approve, spender = factory, amount = launch fee
  exactly; or the escrow for a claim, `claim(AUSD, masterWallet)`); calldata equal to what prepare
  built; value 0; gas ≤ `LAUNCH_MAX_GAS`; fees ≤ 2× a fresh quote; nonce as prepared; then a
  byte-for-byte comparison of the stamped activity with `unsigned_activity`.
- **Grant scope**: the grant commits to name, symbol, URI, metadata hash and preset
  (`PicklerLaunchFactory.sol:288-300`), so an owner cannot swap the image or ticker after the checks.
- **Ticker squatting by owners**: one live draft per agent, reservation TTL (T8), and a validate
  rate limit of 10 per owner per hour (429 with `retryAt`).
- **Reserved and offensive tickers**: a denylist in core (`RESERVED_TICKERS`: Pickler's own, major
  asset symbols such as `$BTC`, `$ETH`, `$MON`, `$AUSD`, `$USDC`) checked at draft and validate.
- **Image abuse**: re-encoding strips payloads; the image is public only after validate; an
  operator can replace a token's served image with a placeholder by deleting the object (the hash
  mismatch is then visible), recorded in `audit.events`.
- **Idempotency**: prepare and submit take `Idempotency-Key` (`audit.idempotency_keys`); a repeated
  submit with a recorded hash answers it without broadcasting, like `409 DEPOSIT_ALREADY_RECORDED` (`studio-create-and-fund-v1.md` §6.2).

## 9. Acceptance criteria and tests

- **Core**: state machine table test (every allowed and refused transition, including revert →
  validated and grant expiry → validated); eligibility for each blocker; metadata canonicalisation
  gives a stable hash; ticker rules equal the DB check and the factory rule on the same vectors.
- **Infrastructure**: the launch transaction builder produces calldata the generated factory ABI
  decodes to the draft; the signed-body inspector refuses each single-field tamper (to, data, value,
  gas, chain, nonce, spender, amount).
- **API** (`workers/api/test`): the full route set against the local DB with a fake Turnkey and a
  scripted chain; idempotent prepare and submit; `LAUNCH_NOT_SENDABLE` before any activity.
- **Web**: the Token section renders every state in §7 from fixtures; `npm run design:check` covers
  the new route states.
- **Staging end to end** (after `launchpad-deploy-v1.md` §9.2): a public test agent launches on
  10143; within 3 minutes the studio shows Launched, `/v1/launches/:id` and `/tokens/<ticker>` show
  the token with its image and agent; a second launch for the same agent is refused at eligibility
  and, if forced through the API, by the factory (`AgentAlreadyLaunched`).

## 10. Rollout and dependencies

Needs first: `launchpad-deploy-v1.md` (contracts deployed, manifest, indexer v2, outbox consumer,
`launchpad_attribution`), `go-public-v1.md` (`visibility`), `production-environment-v1.md`
(bindings, `workers/jobs` and `workers/ops`). The media store (§6.1, migration `media_store`) is
phase 1 work in its own PR, with no launchpad dependency, and ships before Go Public's avatars. Ships behind
`TOKEN_LAUNCH_ENABLED` (API var, default false; the section shows "Launches are paused by Pickler"
while false). Staging first, then production with the production environment work.

## 11. Out of scope

Initial buy at launch; metadata edits after launch; launching from an external wallet; more than
one preset; mainnet; token launches for private agents; transferring the fee recipient from the UI
(the factory supports it, `PicklerLaunchFactory.sol:203-227`); buying and selling (`token-trading-v1.md`).

## 12. Open questions for the owner

1. **Mainnet launch fee**: how much, if anything (testnet is 0)?
2. **Editing after launch**: should an owner ever be able to change the image or description once
   launched (a new metadata version the chain never committed to), or is a launch frozen forever?
3. **Minimum record**: is "public" enough, or must an agent also have N resolved decisions before
   it may launch?

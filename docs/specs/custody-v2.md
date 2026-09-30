# Custody v2: moving funds out, removing passkeys, cleaning up, leaving

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`. Every
decision is reversible unless the table says otherwise.

These are the studio custody follow-ups that `turnkey-passkey-custody-v1.md` and
`studio-create-and-fund-v1.md` left out (research 05 §3 gap 8, spec S6): withdrawing from an agent
wallet to the master wallet, sending from the master wallet to an external address, removing a
passkey, cleaning up orphan sub-organizations and credentials, sweeping stale rows, the stale AGENT
WALLETS panel, and account export and deletion. Turnkey is studio-only (conventions.md "Products and
wallets"). Nothing here touches the marketplace wallets, except that account deletion covers a
wallet-only marketplace account too.

## 1. Problem and users

**Users.** Studio owners, whose money sits in a Turnkey sub-organization where their passkey is the
only root (`turnkey-passkey-custody-v1.md` §2, §12). The operator, who reconciles what Turnkey and
Postgres disagree about.

**Problem.**

1. **Money can go in and not come out.** Deposits master → agent exist
   (`workers/api/src/routes/studio.ts:583-615`, studio-create-and-fund-v1 §6.2). There is no
   withdrawal. The account screen says "Sending is not built yet"
   (`apps/web/src/features/account/sections/wallet.tsx:102`). studio-create-and-fund-v1 §6.3 says
   the master recovers an agent's funds with the passkey, and that "that screen belongs to the account
   work". This is that work.
2. **A passkey cannot be removed.** `security.tsx:77,127` shows "A passkey cannot be removed yet".
   The mirror `wallets.passkeys` has no Turnkey authenticator ID
   (`packages/infrastructure/src/persistence/product/wallets.ts:133-155`), and
   `ACTIVITY_TYPE_DELETE_AUTHENTICATORS` needs one.
3. **Orphans are logged and forgotten.** `reportOrphan`, `reportUnrecordedDelegatedUser` and
   `reportUnrecordedDeposit` (`packages/core/src/features/wallets/application/custody.ts:189-211`)
   go to a log sink. The two credential orphans in `turnkey-passkey-custody-v1.md` §11b (a cancelled
   add-device stamp, a retried registration) have no endpoint.
4. **Nothing sweeps expired rows.** `wallets.webauthn_challenges` has an expiry index and no cleanup
   (`wallets.ts:157-167`, workers/api/AGENTS.md "Passkey custody"). The same goes for
   `identity.siwe_nonces` (`identity.ts:143-148`) and expired `pickler.preview_runs` (migration
   `0022_studio_preview_runs.sql`). `workers/api` has no Cron trigger, and under conventions decision 15 it will not get one.
5. **The AGENT WALLETS panel is stale.** It says "No agent has a wallet of its own yet"
   (`wallet.tsx:143-149`), but agent wallets exist.
6. **No way to leave.** There is no export and no deletion for any account.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Reason                                                                                                                                                                               | Reversible?                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| C1  | **Withdraw agent → master** is a `SIGN_TRANSACTION_V2` from the agent wallet's account, **stamped by the passkey** (root). The delegated user's DENY on `transfer` does not apply to root (studio-create-and-fund-v1 §4.1). It uses the same prepare → stamp → confirm and byte-compare as the deposit, with the recipient fixed to the master address. **Any ERC-20 in `@pickler/chain`'s token manifest** may be withdrawn (AUSD today; Perpl's testnet collateral token when `perpl-live-v1.md` adds it to the manifest), and the manifest supplies the contract that confirm checks.                                                                                                                                                                                                | Reuses the audited deposit path. Recipient fixed to the master: withdrawing is never a way to send somewhere else. One route serves the Perpl collateral leg too (cross-review C13). | yes                                  |
| C2  | **Gas for a withdrawal.** Agent wallets hold AUSD and usually no MON. When the agent's MON is below the quoted fee, the ceremony first sends `MON_GAS_TOPUP_WEI` (default 0.02 MON) master → agent (a native transfer, passkey-stamped), then the withdrawal. That is two stamps, shown as one sheet with two steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Otherwise an agent's AUSD is stuck behind a gas balance nobody told the owner to keep.                                                                                               | yes                                  |
| C3  | A withdrawal that leaves the agent below the schedule floor (10 AUSD, studio-create-and-fund-v1 §6.3) **turns its schedule off** in the same confirm, after an explicit acknowledgement in the sheet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The schedule lock already says an unfunded agent does not run. The owner learns it before signing, not after.                                                                        | yes                                  |
| C4  | **Send master → external address**, for AUSD or MON, is passkey-stamped. The API refuses: the zero address, the AUSD contract itself, any Pickler agent wallet (use deposit), and a non-checksummed mixed-case address. It **warns** (does not refuse) on a contract address (`eth_getCode` non-empty) and on a recipient never sent to before.                                                                                                                                                                                                                                                                                                                                                                                                                                         | Root owns the funds. Pickler prevents the typos that burn money and names the risky cases.                                                                                           | yes                                  |
| C5  | Every outbound transfer is recorded in a new `wallets.transfers` table (withdraw, send, gas top-up). `wallets.deposits` stays as it is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The chain is the truth, and this is the receipt, as with deposits (`wallets.ts:110`).                                                                                                | yes                                  |
| C6  | **Remove a passkey** with `ACTIVITY_TYPE_DELETE_AUTHENTICATORS`, stamped by any remaining passkey (the one being removed included). The last passkey cannot be removed (`409 LAST_PASSKEY`). `wallets.passkeys` gains `turnkey_authenticator_id`, backfilled on the next `GET /passkeys` from Turnkey's authenticator list, matched by credential ID.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Recovery depends on at least one root credential. The authenticator ID is what the activity takes.                                                                                   | yes                                  |
| C7  | **Adopt-or-prune** endpoint for credentials the browser created and the server may not know (§11b of custody v1). If the credential is an authenticator in the sub-org, it is adopted into the mirror. If a pending add-device activity exists for it, that activity is returned to finish. Otherwise the credential is recorded as untrusted, and the browser calls `PublicKeyCredential.signalUnknownCredential` where supported and tells the person to delete it.                                                                                                                                                                                                                                                                                                                   | One endpoint closes both orphan routes, which custody v1 §11b asked for.                                                                                                             | yes                                  |
| C8  | **Orphan sub-organizations.** They are recorded in `wallets.custody_incidents`, not in logs only. Pickler **cannot delete them**: `ACTIVITY_TYPE_DELETE_SUB_ORGANIZATION` must be initiated by a root user of that sub-org, which is the person's passkey. When the orphan's root credential is one of the person's current passkeys and its master wallet balance is zero, the account screen offers "Clean up an unused wallet", a passkey-stamped delete with `deleteWithoutExport: true`. Otherwise the incident stays open for the operator.                                                                                                                                                                                                                                       | Turnkey's rule (API reference, delete sub-organization). An orphan holds no funds unless someone sent to an address nobody was ever shown. The balance check guards that case.       | the delete: **no**                   |
| C9  | The two other incident kinds (`unrecorded_delegated_user`, `unrecorded_deposit`) go to the same table. A reconciler job repairs `unrecorded_deposit` automatically (it reads the receipt and inserts the `deposits` row). The delegated-user case stays with the operator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Turns three log lines into a queue with an owner.                                                                                                                                    | yes                                  |
| C10 | **Scheduled work follows conventions decisions 15 and 18.** Table retention (expired `webauthn_challenges`, `siwe_nonces`, `preview_runs`) is owned by `operations-v1.md` (O12) in `workers/ops`, and this spec adds nothing to it. The add-device abandonment job is pure housekeeping and runs in `workers/ops` every 15 minutes. The **deposit reconciler** repairs product money records, so `workers/jobs` dispatches it every 15 minutes by calling `POST /v1/internal/custody/reconcile-deposits`, and the API does the work. The account-deletion job is dispatched the same way, daily, through `POST /v1/internal/account/deletions/run`. `workers/jobs` has no database and no secrets, and `workers/api` has no cron. Each job is bounded (1 000 rows) and logs its counts. | One owner per table and the worker homes of decision 18 (cross-review C7, W1; scope §9.4 items 1-2).                                                                                 | yes                                  |
| C11 | **Account export**: `POST /v1/me/account/export` builds a JSON archive (profile, wallet links, passkey labels, agent configs, runs and decisions, ledger entries, deposits and transfers, reads, follows, notifications) into R2, reachable by a 24-hour signed link. One export per account per 24 h. The master wallet's key is **not** in it: exporting keys uses Turnkey's export iframe (§3.6).                                                                                                                                                                                                                                                                                                                                                                                    | Data portability without Pickler ever holding key material.                                                                                                                          | yes                                  |
| C12 | **Account deletion** has a **7-day grace period**. The request revokes every session. Signing in during the grace period offers "Cancel deletion". When the grace ends, a job deletes personal data and anonymizes what must remain (§5.3). A studio account must first either bring every balance under 0.01 AUSD and 0.001 MON, or confirm it has exported the master wallet (C11/§3.6).                                                                                                                                                                                                                                                                                                                                                                                              | Deleting a person must not strand their money. The grace period catches a mistake or a stolen session.                                                                               | during the grace: yes. After: **no** |
| C13 | After deletion the handle stays **reserved for 90 days**, and public agent records (resolved decisions, a launched token) remain, attributed to "a deleted account". Financial rows (ledger, deposits, transfers, paid reads) are kept, with `user_id` replaced by a tombstone ID.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The public record and receipts are other people's evidence too (conventions decisions 1-2). Money records must survive.                                                              | yes (the policy)                     |
| C14 | The account screen's **Wallets** section lists the master and every agent wallet with its AUSD and MON balance, from a new `GET /v1/signing/wallets`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | It replaces the stale panel (`wallet.tsx:143-149`).                                                                                                                                  | yes                                  |

## 3. User flows

All of these are on `studio.pickler.fun`, in `/account` or the agent's home, and every stamp is the
person's passkey.

### 3.1 Withdraw from an agent

1. Agent home → wallet card → **Withdraw** (beside Deposit). The sheet shows the agent's AUSD balance
   and the chips 10 / 25 / 50 / All, and "Goes to your master wallet 0xAB…CD".
2. `POST …/withdraw/prepare { asset, amountMicroAusd | all: true }`. The API reads the balances, quotes gas,
   and returns one or two unsigned activities: the gas top-up if needed (C2), then the transfer. If the
   result would drop below 10 AUSD while the schedule is on, `schedule_off: true` is in the response,
   and the sheet asks for the acknowledgement (C3).
3. The person stamps each activity (one or two passkey prompts; the sheet shows "1 of 2", "2 of 2").
4. `POST …/withdraw/confirm` with the stamped activities. The API inspects each one as it does for a
   deposit (chain 10143, from the agent's address, `to` = the asset's contract from the manifest,
   `transfer(master, amount)`,
   value 0, gas ≤ 250k, fees ≤ 2× a fresh quote; for the top-up: from the master, `to` = agent, value =
   the top-up, empty data). It byte-compares, forwards, broadcasts in order (waiting for the top-up's
   receipt), records `wallets.transfers`, turns the schedule off if acknowledged, and invalidates the
   balance cache.

### 3.2 Send from the master wallet

1. `/account` → Wallets → master → **Send**. Asset (AUSD or MON), amount, recipient.
2. `POST /v1/signing/wallets/master/send/prepare`. The API refuses or warns per C4. Warnings come back
   as `warnings: ["CONTRACT_RECIPIENT" | "NEW_RECIPIENT"]`, and each one needs a tick in the sheet.
3. The sheet shows the recipient split in groups of four characters, the amount, the fee, and "This
   cannot be undone". Then the stamp.
4. `POST …/send/confirm`: inspect, byte-compare, broadcast, record.

### 3.3 Remove a passkey

`/account` → Security → a passkey → **Remove**. The sheet names the device and says how many remain.
`prepare` builds `DELETE_AUTHENTICATORS` for the root user with that authenticator ID. The person
stamps it with any remaining passkey (the browser offers them all). `confirm` forwards it and deletes
the mirror row. The last passkey has no Remove, only "Add another device first".

### 3.4 A credential the server may not know

After any registration or add-device ceremony that ended abnormally (cancelled, timed out, or a
retried `register` that returned an existing account), the browser calls
`POST /v1/signing/passkeys/reconcile { credentialId }` with the credential it created. The answer is
`adopted`, `resume` (with the activity to stamp), or `untrusted`. For `untrusted` the page calls
`signalUnknownCredential` when the browser has it, and otherwise shows "Your password manager has a
Pickler passkey that does not work. You can delete it."

### 3.5 Clean up an unused wallet

When `custody_incidents` holds an open `orphan_sub_org` for this person whose root credential is one
of their passkeys, Security shows "An unused Pickler wallet was created during a retried sign-up. It
holds nothing. Remove it." Prepare checks that its master balance is zero and builds
`DELETE_SUB_ORGANIZATION { deleteWithoutExport: true }` for that sub-org. The person stamps it, and
confirm forwards it and closes the incident.

### 3.6 Export and delete the account

- **Export data.** `/account` → Privacy → **Export my data**. This queues the job. When it is ready,
  the page (and an email) gives a download link valid for 24 h.
- **Export the master wallet.** `/account` → Wallets → master → **Export recovery phrase**. This uses
  Turnkey's export iframe (`EXPORT_WALLET` to the iframe's target key, passkey-stamped). The phrase is
  decrypted only inside Turnkey's iframe and never reaches Pickler.
- **Delete.** `/account` → Privacy → **Delete account**. The page lists what happens (C12, C13) and
  the blockers: live balances (with Withdraw and Send links, or "I exported my recovery phrase"),
  agents still scheduled (they are paused automatically), and an open paid read as a buyer (the refund
  still reaches the wallet on chain). The person types their handle, stamps with the passkey (studio
  accounts) or signs a SIWE message (wallet-only accounts), and the request is recorded. Every session
  is revoked. After 7 days the job runs.

## 4. API

Studio and signing routes need a Supabase JWT and the custody account. `/v1/me/account/*` serves any
signed-in user (studio or marketplace, one Supabase user, product-hosts-v1 §5), under conventions.md's
redefinition of `/v1/me/*` as any signed-in user's own account (cross-review E5). Every POST that moves
money or creates something takes `Idempotency-Key`.

| Method | Path                                        | Request                                                                                         | Response `data`                                                                                                            | Errors                                                                                                         |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/signing/wallets`                       | none                                                                                            | `[{ role: "master" \| "agent", agentId?, handle?, walletId, address, ausdMicro: string \| null, monWei: string \| null }]` | 404 `NO_CUSTODY`; balances `null` (never 0) when the chain is unreachable                                      |
| POST   | `/v1/studio/agents/:id/withdraw/prepare`    | `{ asset?: string (default "AUSD"), amountMicroAusd: string } \| { asset?: string, all: true }` | `{ activities: UnsignedActivity[] (1-2), asset, amountBaseUnits, gasTopUpWei: string \| null, scheduleOff: boolean }`      | 409 `NOTHING_TO_WITHDRAW`, 409 `MASTER_CANNOT_PAY_GAS`, 400 `INVALID_AMOUNT`, 409 `AMOUNT_ABOVE_BALANCE`       |
| POST   | `/v1/studio/agents/:id/withdraw/confirm`    | `{ signed: StampedActivity[], acknowledgeScheduleOff?: boolean }`                               | `{ transfers: [{ id, kind, txHash }], scheduleOff: boolean }`                                                              | 400 `ACTIVITY_MISMATCH`, 409 `SCHEDULE_ACK_REQUIRED`, 409 `TRANSFER_ALREADY_RECORDED`, 502 `BROADCAST_FAILED`  |
| POST   | `/v1/signing/wallets/master/send/prepare`   | `{ asset: "AUSD" \| "MON", amount: string (micro-AUSD or wei), to }`                            | `{ activity, fee: { monWei }, warnings: ("CONTRACT_RECIPIENT" \| "NEW_RECIPIENT")[] }`                                     | 400 `INVALID_RECIPIENT`, 400 `RECIPIENT_IS_TOKEN`, 400 `RECIPIENT_IS_AGENT_WALLET`, 409 `AMOUNT_ABOVE_BALANCE` |
| POST   | `/v1/signing/wallets/master/send/confirm`   | `{ signed, acknowledged: string[] }`                                                            | `{ transferId, txHash }`                                                                                                   | 400 `ACTIVITY_MISMATCH`, 409 `WARNING_NOT_ACKNOWLEDGED`, 409 `TRANSFER_ALREADY_RECORDED`                       |
| GET    | `/v1/signing/transfers`                     | `?cursor=&limit=`                                                                               | `[{ id, kind, asset, amount, from, to, txHash, status, createdAt, confirmedAt }]`                                          |                                                                                                                |
| POST   | `/v1/signing/passkeys/:id/remove/prepare`   | none                                                                                            | `{ activity }`                                                                                                             | 404, 409 `LAST_PASSKEY`, 409 `AUTHENTICATOR_UNKNOWN` (the backfill failed)                                     |
| POST   | `/v1/signing/passkeys/:id/remove/confirm`   | `{ signed }`                                                                                    | `{ removed: true, remaining }`                                                                                             | 400 `ACTIVITY_MISMATCH`, 409 `LAST_PASSKEY`                                                                    |
| POST   | `/v1/signing/passkeys/reconcile`            | `{ credentialId }`                                                                              | `{ outcome: "adopted" \| "resume" \| "untrusted", activity? }`                                                             | 400                                                                                                            |
| GET    | `/v1/signing/incidents`                     | none                                                                                            | `[{ id, kind: "orphan_sub_org", createdAt, cleanable: boolean }]` (this user's open incidents only)                        |                                                                                                                |
| POST   | `/v1/signing/incidents/:id/cleanup/prepare` | none                                                                                            | `{ activity }`                                                                                                             | 409 `NOT_CLEANABLE` (balance not zero, root not one of the person's passkeys)                                  |
| POST   | `/v1/signing/incidents/:id/cleanup/confirm` | `{ signed }`                                                                                    | `{ closed: true }`                                                                                                         | 400 `ACTIVITY_MISMATCH`                                                                                        |
| POST   | `/v1/me/account/export`                     | none                                                                                            | `{ exportId, status: "queued" }`                                                                                           | 429 `EXPORT_RATE_LIMITED` (`retryAt`)                                                                          |
| GET    | `/v1/me/account/export/:id`                 | none                                                                                            | `{ status: "queued" \| "ready" \| "failed", url?, expiresAt? }`                                                            | 404                                                                                                            |
| POST   | `/v1/me/account/deletion`                   | `{ confirmHandle, proof: { stamped } \| { raw, signature }, exportedRecoveryPhrase?: boolean }` | `{ scheduledFor }`                                                                                                         | 409 `BALANCES_REMAIN`, 400 `HANDLE_MISMATCH`, 401 `PROOF_INVALID`                                              |
| DELETE | `/v1/me/account/deletion`                   | none                                                                                            | `{ cancelled: true }`                                                                                                      | 404 `NO_PENDING_DELETION`, 409 `DELETION_STARTED`                                                              |

The existing studio routes answer without the envelope (`studio.ts:595`). The new ones use it.
`UnsignedActivity` and `StampedActivity` are the shapes the deposit already uses (`url`, `body`,
`timestampMs`, `organizationId`). Each route gets its own response type in `packages/api-schema`
(turnkey-passkey-custody-v1 §12: "give each response its own type").

## 5. Data model and migrations

Numbers are assigned at build time (the next free number is 0023).

### 5.1 `custody_transfers_and_incidents`

- `wallets.transfers (id uuid pk, user_id uuid not null, kind text check in ('withdraw_agent','send_external','gas_topup'), agent_id uuid null references agents.agents(id) on delete set null, asset text not null check (asset ~ '^[A-Z0-9]{2,12}$') (a symbol from `@pickler/chain`'s token manifest, or `MON`), token_contract text null, amount_base_units numeric(78,0) not null check (> 0), from_address text, to_address text, tx_hash text not null unique check (~ '^0x[0-9a-f]{64}$'), status text check in ('broadcast','confirmed','failed'), created_at timestamptz, confirmed_at timestamptz)`,
  with index `(user_id, created_at desc)`. AUSD base units are micro-AUSD, and MON base units are wei.
- `wallets.passkeys`: add `turnkey_authenticator_id text null`, with a unique index where it is not null.
- `wallets.untrusted_credentials (credential_id text pk, user_id uuid not null, reason text check in ('cancelled_add','retried_register','unknown'), created_at)`.
- `wallets.pending_additions (credential_id text pk, user_id uuid, activity jsonb not null, created_at, abandoned_at timestamptz null)`. `add/prepare` writes it, and `add/confirm` deletes it, so reconcile can offer `resume`.
- `wallets.custody_incidents (id uuid pk, user_id uuid not null, kind text check in ('orphan_sub_org','unrecorded_delegated_user','unrecorded_deposit'), detail jsonb not null (ids and amounts only), state text check in ('open','repaired','closed_by_user','closed_by_operator'), created_at, closed_at)`.
  The `reportOrphan`, `reportUnrecordedDelegatedUser` and `reportUnrecordedDeposit` sinks
  (`custody.ts:189-211`) write here as well as to the log. They stay synchronous and never throw into
  the caller: the write is fire-and-forget, with its failure logged.

### 5.2 `account_export_and_deletion`

- `identity.account_exports (id uuid pk, user_id uuid not null, status text check in ('queued','ready','failed'), object_key text, expires_at timestamptz, created_at)`.
- `identity.account_deletions (user_id uuid pk, requested_at timestamptz not null, scheduled_for timestamptz not null, started_at timestamptz, completed_at timestamptz, tombstone_id uuid not null default gen_random_uuid())`.
- `identity.reserved_handles`: a row per deleted handle, with `until = completed_at + 90 days`. It reuses
  the reserved-names check in `packages/core/src/features/profiles/`.

### 5.3 What deletion removes and keeps

| Removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Kept, with `user_id` → `tombstone_id`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.users` (Supabase admin `deleteUser`), `identity.profiles`, `identity.notify_emails` and `identity.notify_email_tokens` (`paid-reads-v1.md`; both cascade from `auth.users`, and the job also deletes them explicitly first), `identity.wallet_links`, `wallets.passkeys`, `wallets.turnkey_orgs`/`wallets`/`wallet_accounts` mirrors, `me.devices`, `me.notifications`, `me.notification_preferences`, `me.legacy_migrations`, `agents.follows` (`public-record-v1.md`), deleted by `user_id` explicitly, because follows have no foreign key to `identity.profiles` or `auth.users` and nothing cascades to them, `media.uploads` whose `owner_id` is the user id (keyed on `auth.users.id` with no foreign key, conventions decision 23) and that are not attached to a launched token, with their R2 objects (`token-launch-v1.md`), private agent configs, drafts, preview runs, private runs and events of unpublished decisions | `budget.ledger_entries`, `wallets.deposits`, `wallets.transfers`, paid reads as buyer and as seller (`paid-reads-v1.md`), `market.trade_requests` (`token-trading-v1.md`), `agents.brief_loads` (`fork-agent-v1.md`, the public "forked from" attribution), `media.uploads` attached to a launched token (`owner_id` → tombstone), resolved public decisions and receipts, `market.*` launch records, the public agent profile (owner shown as "a deleted account") |

The job deletes the rows keyed by `user_id` explicitly and in one transaction before calling Supabase
`deleteUser`: `agents.follows`, `identity.notify_emails`, `identity.notify_email_tokens`, `me.*`,
`media.uploads` (by `owner_id`, deleting or tombstoning as the table above says),
`identity.wallet_links` and the `wallets.*` mirrors. It never relies on a cascade from `auth.users`,
which several of these tables do not have. A test seeds a follow and a notification email for the
account, runs the job, and asserts that neither remains.

The Turnkey sub-organization is **not** deleted by Pickler (C8: only its root can). If the person
stamped the optional "Delete my Turnkey wallet" step at request time (a `DELETE_SUB_ORGANIZATION`,
offered only when balances are zero), it is forwarded when the grace period ends. Otherwise it
remains, reachable only by their passkey, and the export or recovery phrase is how they reach funds
outside Pickler.

## 6. Integrations

| System            | Use                                                                                                                                                                                                                             | Config                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turnkey           | `SIGN_TRANSACTION_V2`, `DELETE_AUTHENTICATORS`, `DELETE_SUB_ORGANIZATION`, `EXPORT_WALLET`, the authenticator list                                                                                                              | existing `TURNKEY_*`. The export iframe origin `https://export.turnkey.com` is added to the studio CSP `frame-src`                                                                      |
| Monad RPC         | balances, gas quotes, receipts                                                                                                                                                                                                  | existing `MONAD_RPC_URL`, `CHAIN_ID`                                                                                                                                                    |
| Cloudflare Cron   | add-device abandonment (`workers/ops`, `*/15`); deposit reconciler (`workers/jobs` `*/15` → `POST /v1/internal/custody/reconcile-deposits`); deletions (`workers/jobs` daily → `POST /v1/internal/account/deletions/run`) (C10) | `production-environment-v1.md` cron table; table retention stays with `operations-v1.md`                                                                                                |
| Cloudflare R2     | export archives                                                                                                                                                                                                                 | bucket `pickler-exports` (binding `EXPORTS`), lifecycle rule deleting objects after 2 days                                                                                              |
| Cloudflare Queues | export and deletion work                                                                                                                                                                                                        | queue `pickler-account-jobs-<env>`, produced **and consumed by `workers/api`** (conventions decision 18); dead-letter queue `pickler-account-jobs-dlq-<env>`, consumed by `workers/ops` |
| Supabase Auth     | revoke sessions (admin `signOut(userId, 'global')`), `deleteUser`                                                                                                                                                               | the existing admin client (`wallet-accounts.ts`)                                                                                                                                        |
| API vars          |                                                                                                                                                                                                                                 | `MON_GAS_TOPUP_WEI=20000000000000000`, `ACCOUNT_DELETION_GRACE_DAYS=7`, `HANDLE_QUARANTINE_DAYS=90`, `DUST_AUSD_MICRO=10000`, `DUST_MON_WEI=1000000000000000`                           |
| Email             | "your export is ready", "your account will be deleted on …"                                                                                                                                                                     | the email provider of `paid-reads-v1.md`, sent only to the **verified notification email**; with none, the `me.notifications` inbox (`mobile-backend-v1.md` M6)                         |

## 7. Design work

All of these are on the **studio** (dark surface). `/account` has a canvas (`Pickler Account`,
design-system-v2 §5) with a light wallet card. The rows marked **draw** add frames to it or to
`Pickler Studio v4`.

| Screen                                                            | States                                                                                                    | Canvas                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Withdraw sheet (agent home)                                       | amount chips, All, gas top-up step (1 of 2 / 2 of 2), schedule-off acknowledgement, sending, sent, failed | **draw**, in `Pickler Studio v4` beside the deposit sheet                                              |
| Account → Wallets (replaces the stale panel)                      | master and agent rows with balances, balance unknown, no agent wallets yet                                | **draw**, in `Pickler Account`                                                                         |
| Send sheet (master)                                               | asset, amount, recipient; refused (each C4 case); warnings with ticks; confirm; sent                      | **draw**, in `Pickler Account`                                                                         |
| Transfers list                                                    | empty, rows (withdraw, send, gas), pending, failed                                                        | **draw**, in `Pickler Account`                                                                         |
| Security → Remove passkey                                         | confirm with the remaining count, last passkey (no Remove), removed                                       | extend the existing Security section frame                                                             |
| Untrusted credential notice                                       | "a Pickler passkey that does not work", with and without Signal API support                               | **draw**                                                                                               |
| Clean up an unused wallet                                         | offered, stamping, done, not cleanable                                                                    | **draw**                                                                                               |
| Privacy → Export data                                             | idle, queued, ready (link), failed, rate limited                                                          | **draw**, a new Privacy section                                                                        |
| Export recovery phrase                                            | the Turnkey iframe inside a Pickler frame, warnings                                                       | **draw**                                                                                               |
| Privacy → Delete account                                          | blockers list, type-your-handle, stamp, scheduled with Cancel, grace-period banner on sign-in             | **draw**                                                                                               |
| Marketplace account sheet → Delete account (wallet-only accounts) | the same blockers without custody; SIWE proof                                                             | **draw**, on the marketplace web light surface, beside the Wallets section (marketplace-wallets-v1 §7) |

`scripts/design/routes.mjs`: Account → Wallets with two agents, the withdraw sheet in its gas step, and
the delete flow's scheduled state.

## 8. Security and abuse

- **Byte-exact confirm.** Every stamped activity is compared with the one that prepare issued, and its
  decoded transaction is inspected field by field before forwarding (the deposit rule,
  studio-create-and-fund-v1 §6.2). Nothing the browser changes after prepare is ever forwarded.
- **Withdraw only to the master.** The recipient is fixed server-side (C1). A stamped withdrawal to any
  other address is `ACTIVITY_MISMATCH`.
- **The delegated user stays powerless.** No new policy is created, and the DENY policies are untouched.
  Every flow here is root-only.
- **A stolen studio session** cannot move money: every flow needs a passkey stamp. It can request an
  export (rate limited, announced only to the **verified notification email** of `paid-reads-v1.md`
  or in the in-app inbox, and the link only works for that session's
  user) and can request a deletion only with a passkey stamp or a fresh SIWE signature.
- **Removing the last root** is refused in core and in the route. The UI never offers it.
- **Orphan deletion** is only offered when the orphan's master balance is zero on chain at prepare time,
  and it is re-checked at confirm.
- **Sweepers** delete only expired rows by indexed expiry, in bounded batches, and never touch a
  challenge that is still valid.
- **Export archives** are private R2 objects behind short-lived signed URLs and are deleted after 2 days.
  They contain no key material.
- **Deletion grace.** All sessions are revoked at the request, and the cancel needs a fresh sign-in, so a
  thief who requested it cannot also cancel the owner's cancel.

## 9. Acceptance criteria and tests

1. Core, with fake ports: withdraw prepare with and without a gas top-up; schedule-off on falling below
   the floor; send refusals and warnings (C4); `LAST_PASSKEY`; reconcile's three outcomes; the incident
   sinks write and never throw.
2. API: each route in §4 with its errors; confirm refuses a changed recipient, amount, chain or gas;
   `TRANSFER_ALREADY_RECORDED` without re-broadcasting.
3. Infrastructure: the migrations on 0022; the add-device abandonment job touches only pendings older than 15 minutes; the deposit
   reconciler inserts one row per open `unrecorded_deposit` and closes it.
4. Deletion job: on a seeded account, every row in §5.3's left column is gone and every row in the right
   column carries the tombstone. The handle is reserved.
5. **Real Turnkey on staging, recorded in a dated doc:** a withdrawal with a gas top-up from a funded agent
   to the master (tx hashes), a send of 1 AUSD to an external test address, the removal of a second
   passkey, a reconcile after a cancelled add-device stamp, and the deletion of an orphan sub-org with a
   zero balance. This is also the real-policy-engine validation that studio-create-and-fund-v1
   "Validation" §2-4 left open: a delegated-user `transfer` from the agent wallet is refused by Turnkey.

## 10. Rollout and dependencies

1. **Needs first:** `TURNKEY_RPID=studio.pickler.fun` and the Turnkey secrets bound on the deployed API
   (research 05 §2.6; `production-environment-v1.md`), and a real testnet deposit done once.
2. Order: the housekeeping jobs and incidents (no UI risk) → Wallets list (C14) → withdraw → send → remove passkey and
   reconcile → orphan cleanup → export → deletion.
3. Deletion needs the `me` schema (mobile-backend-v1) and the `paid-reads-v1.md` tables to exist, so that its
   table of removed and kept rows is complete. Until then it covers what exists and the job's list is
   extended with each new table (a test fails when a table that has a `user_id` column is in neither
   list).
4. The same change updates workers/api/AGENTS.md's route table (it also leaves out `GET
/v1/signing/passkeys` today, research 05 §3 gap 11) and `apps/web/AGENTS.md`'s custody section.

## 11. Out of scope

Withdrawing from inside a Perpl exchange account to the agent wallet (`perpl-live-v1.md`; the agent →
master leg afterwards uses C1); a per-agent address book; spending
limits on root (root is the person); social recovery or a co-signer; moving an agent between accounts;
deleting a sub-organization without its root; GDPR tooling beyond export and deletion (for example
rectification requests handled by the operator).

## 12. Open questions for the owner

1. **Retention period for financial rows after deletion.** C13 keeps them indefinitely with a
   tombstone. Is there a legal retention period you want (for example 7 years, then purge)?
2. **Turnkey cost of orphan sub-organizations.** If Turnkey bills per sub-organization, open orphans
   that nobody can delete cost money forever. Is that acceptable, or should the operator ask Turnkey
   support to remove them?

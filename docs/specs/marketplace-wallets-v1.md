# Marketplace wallets v1: Mera on web and phone, an EOA on the web, one account

Status: Draft — decided autonomously 2026-09-30. Every decision below is reversible unless the
Decisions table says otherwise. Follows `docs/product-map/conventions.md`.

This spec brings Mera back to the web marketplace as its primary wallet, keeps the injected EOA as
the web-only alternative, makes Mera the only wallet in the mobile app, and turns "one marketplace
account per person with several wallets" into screens and routes. It supersedes the web half of
`product-hosts-v1.md` §2 ("on the web the marketplace takes an injected EOA", line 71) and §7 "Mera
on the web" (line 247), and it supersedes `turnkey-passkey-custody-v1.md` §6 "The PRF signer is
retired" (line 203) as a ban on Mera. That section retired the PRF signer because Mera and Turnkey
shared the relying party `pickler.fun`. The three-host split removes that reason.

## 1. Problem and users

**Users.** People who read, pay for and trade on the marketplace (`app.pickler.fun` and the React
Native app). They are not agent builders. Builders use the studio and Turnkey, and nothing here
touches them.

**Problem.**

1. The owner's rule (conventions.md "Products and wallets") makes Mera the marketplace's wallet on
   the web and the phone, with an injected EOA as a web-only fallback. On `main` the web offers only
   the EOA: `SignerKind = "injected"` (`apps/web/src/features/wallet/lib/signer.ts:14`), one chooser
   entry (`components/connect-modal.tsx:19-25`). `mera-signer.ts` was deleted in PR #64, and
   `@category-labs/mera` is not a dependency.
2. `apps/web/AGENTS.md` ("The wallet") says "Nothing in this app derives or holds a private key,
   and no new signer may". That contradicts the rule and has to change in the same change that
   ships web Mera.
3. `identity.wallet_links.kind` allows `'mera'`
   (`packages/infrastructure/src/persistence/product/identity.ts:124`), but both writers hard-code
   `"external"` (`packages/core/src/features/identity/application/wallet-sign-in.ts:226,245`), and
   the request has no field that could carry the kind (`workers/api/src/routes/wallet-auth.ts:77-97`).
4. Linking a second wallet exists in the API (`wallet-auth.ts:118,125`) and in no screen.
   Unlinking, labelling and switching wallets exist nowhere.
5. The marketplace wallet has never signed anything except a SIWE message (`apps/web/AGENTS.md`:
   "It never signs or sends anything"). Paid reads (conventions decision 3) and token trades need
   it to sign transactions, and how each wallet presents a signing request is undefined.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reason                                                                                                                                                                                                                     | Reversible?                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D1  | Web Mera calls the `@category-labs/mera` SDK directly (pinned `0.2.x`, exact version in the lockfile) behind a second `SignerKind`, `"mera"`. No wagmi, no synthesized EIP-1193 provider.                                                                                                                                                                                                                                                                                                                                                              | The SDK has no provider. `toViemAccount().signMessage` is all SIWE needs, and `signTransaction` is all a payment needs (user-profiles-and-products-v1 §13 "What Mera turned out to need").                                 | yes                                                                         |
| D2  | Key model: the **PRF model** (`getPasskeyPrfOutput({ rpId })` used as the secp256k1 key). The vault model is not used on any surface.                                                                                                                                                                                                                                                                                                                                                                                                                  | It is deterministic per credential and RP, so one passkey is one address on the web and the phone with nothing to sync (`docs/market/token-launch.md:41`). The vault model does not cross devices.                         | **no** once people hold funds: switching models changes every address       |
| D3  | Mera's relying party is **`app.pickler.fun`** on the web and in the app (`NEXT_PUBLIC_MERA_RP_ID`).                                                                                                                                                                                                                                                                                                                                                                                                                                                    | product-hosts-v1 §3-4. The two passkey kinds must never share a picker.                                                                                                                                                    | **no** after the first enrolment (product-hosts-v1 §8)                      |
| D4  | Web Mera ships **only after** `product-hosts-cutover-v2.md` (H2, H6) is live: `TURNKEY_RPID=studio.pickler.fun`, and a studio that can no longer land on `app.pickler.fun` (`apps/web/src/server/hosts.ts:12` falls back to it today). The flag `NEXT_PUBLIC_MERA_WEB` is off by default, and the build fails if it is on while `NEXT_PUBLIC_MARKETPLACE_HOST` or `NEXT_PUBLIC_STUDIO_HOST` is unset.                                                                                                                                                  | Research 05 §7.2 item 5: while the studio can land on `app.pickler.fun`, a Mera passkey enrolled there appears in Turnkey's picker.                                                                                        | yes                                                                         |
| D5  | **Key-in-page policy.** The derived key exists only for the length of one ceremony (sign in, pay, trade). The page runs `getPasskeyPrfOutput` (one biometric), signs, and drops the session. Nothing is written to `localStorage`, `sessionStorage` or IndexedDB. No long-lived Mera signing session on the web.                                                                                                                                                                                                                                       | The owner's rule accepts Mera on the web. This is the mitigation research 05 §7.2 item 1 asks for: the key is in memory for seconds, not for the life of the tab.                                                          | yes (a 5-minute session is a one-line change if the prompts prove too many) |
| D6  | **Strict CSP on the marketplace host**: `script-src 'self'` plus nonces, no third-party script on any page that can load the Mera signer, `connect-src` limited to the API proxy, the Monad RPC and Supabase. The TradingView chart library is self-hosted, not loaded from a CDN.                                                                                                                                                                                                                                                                     | A key in the page is only as safe as the scripts beside it.                                                                                                                                                                | yes                                                                         |
| D7  | A passkey with no PRF output is a named error, `MERA_PRF_UNAVAILABLE`, with its own screen. The screen explains which password managers work and offers "Use a browser wallet instead". On the phone it offers no fallback, only the fix.                                                                                                                                                                                                                                                                                                              | user-profiles-and-products-v1 §13 answer 3: local Chrome profile, Bitwarden and Dashlane on desktop Chrome return no PRF.                                                                                                  | yes                                                                         |
| D8  | The EOA stays **web only**: injected EIP-1193 through the existing `injected-signer.ts`. No WalletConnect in v1, and none on the phone.                                                                                                                                                                                                                                                                                                                                                                                                                | Owner's rule. product-hosts-v1 §7 lists WalletConnect as a later day of work.                                                                                                                                              | yes                                                                         |
| D9  | `kind` (`"mera"` or `"eoa"`) is a field on `POST /v1/auth/wallet/verify` and `POST /v1/auth/wallet/link`, written to `wallet_links.kind` when the link is created. The stored value `'external'` becomes `'eoa'`. The kind is **descriptive, not trusted**: nothing is granted or refused because of it. The first writer wins; a later sign-in with another claim does not rewrite it.                                                                                                                                                                | The server cannot tell a PRF-derived key from any other EOA: both are plain `ecrecover`. The kind exists only to tell a person which of their wallets is which (product-hosts-v1 §2). Answers research 05 open question 9. | yes                                                                         |
| D10 | One marketplace account = one Supabase user, one profile, one handle, **up to 5 linked wallets**. A wallet already linked to another account is refused (`409 ADDRESS_TAKEN`) and never moved. There is no account merge.                                                                                                                                                                                                                                                                                                                              | user-profiles-and-products-v1 §3 and `wallet-sign-in.ts:234-252` already refuse moves. The cap bounds abuse and the list UI.                                                                                               | yes                                                                         |
| D11 | Unlinking the last wallet depends on a **login email**: an email or Google identity in Supabase Auth (`auth.identities`), the kind the studio signs in with. An account with a login email may unlink every wallet. A **wallet-only account** (`app_metadata.pickler_account = "wallet"`, no login identity) cannot unlink its last wallet (`409 LAST_WALLET`). The **notification email** of `paid-reads-v1.md` (`identity.profiles.notify_email`) never counts: it is a profile field, never a login, and adding it never changes `pickler_account`. | A wallet-only account with no wallet has no way back in, and a notification email cannot sign anyone in (cross-review X1).                                                                                                 | yes                                                                         |
| D12 | **Switching wallets.** A session stays bound to the user, and it may be reused for any address **linked to that user**. Connecting an unlinked address signs again. `decideSession` gains the list of linked addresses.                                                                                                                                                                                                                                                                                                                                | The address binding in `wallet-session.ts:1-10` exists so a token is never sent under someone else's name. A linked address is the same person. This saves a Mera biometric on every switch.                               | yes                                                                         |
| D13 | **Session lifetime.** The Supabase access token keeps its default 1 h and is refreshed on the client. The refresh token is rotated. A marketplace session ends after 30 days without use, and then the next action signs SIWE again. An unreadable or expired token signs again, as `decideSession` does now.                                                                                                                                                                                                                                          | Paid reads come back a day later (user-profiles-and-products-v1 §8). A person should not sign every morning.                                                                                                               | yes                                                                         |
| D14 | Pickler draws its **own confirmation sheet** before every signature, for both wallet kinds. For Mera it is the only UI there is. For an EOA it comes before the wallet's own prompt and says the same thing in words.                                                                                                                                                                                                                                                                                                                                  | Mera has no UI of its own, and a person should read the same summary whichever wallet signs.                                                                                                                               | yes                                                                         |
| D15 | A Mera transaction is signed in the page (`signTransaction`) and **broadcast by the page** to the Monad RPC in `@pickler/chain`. Then its hash goes to the API, which verifies it on chain. An EOA uses `eth_sendTransaction`. The API never receives a raw signed transaction from the marketplace.                                                                                                                                                                                                                                                   | The paid-read rail verifies transfers on chain (conventions decision 3). Pickler never relays marketplace money.                                                                                                           | yes                                                                         |
| D16 | The buyer pays gas in MON. A wallet with no MON sees a "needs MON for gas" state with the testnet faucet. Sponsored gas is out of scope.                                                                                                                                                                                                                                                                                                                                                                                                               | Keeps v1 free of a paymaster.                                                                                                                                                                                              | yes                                                                         |
| D17 | Chooser order on the web: **Mera first** ("Passkey wallet · Mera"), then "Browser wallet". Mera has two entries: "Create a passkey wallet" and "I already have one".                                                                                                                                                                                                                                                                                                                                                                                   | Mera is the primary wallet under the rule. Creating and asserting are different WebAuthn ceremonies.                                                                                                                       | yes                                                                         |

## 3. User flows

### 3.1 First visit, web, Mera

1. The person clicks something that needs a wallet (Pay for a read, Follow, Portfolio). `connect(holding)`
   opens the chooser with the held action on it, as today.
2. The person picks **Create a passkey wallet**. The page calls
   `createPasskeyWithPrfOutput({ rpId: "app.pickler.fun", userName: "Pickler wallet" })`. That is one
   biometric, and it creates the credential and returns the PRF output.
3. If the authenticator returned no PRF output: the `MERA_PRF_UNAVAILABLE` screen (§7). The credential
   that was created is useless. The screen says so and tells the person they can delete "Pickler
   wallet" from their password manager.
4. The page derives the address, calls `POST /v1/auth/wallet/nonce` with
   `{ address, chain_id: 10143, client: "web" }`, gets `{ nonce, message }`, and shows the sign-in
   sheet (§3.6). "Sign in" signs the message **with the same PRF output**, with no second biometric.
   Then it calls `POST /v1/auth/wallet/verify` with `{ raw, signature, kind: "mera" }`.
5. The key is dropped. The session is stored as today (`WalletSession`, bound to the user, and now to
   the user's linked addresses too).
6. The held action continues.

**Returning, web, Mera.** "I already have one" calls `getPasskeyPrfOutput({ rpId })` with no
`allowCredentials`, so the OS offers the person's discoverable Pickler credentials. It then continues
at step 4. If the session is still valid, nothing is asked until the next signature.

### 3.2 Web, browser wallet

This is unchanged from `main` (`lib/connect.ts:36-57`), except that the nonce request carries
`client: "web"` and the verify request carries `kind: "eoa"`.

### 3.3 Phone, Mera only

This is the same ceremony through `@category-labs/mera/react-native-webauthn-client`, with the same
`rpId`. The phone may keep a Mera signing session in its sandbox for up to 5 minutes (the key is in
the app's process, not beside third-party scripts). `docs/specs/mobile-backend-v1.md` owns the
details.

### 3.4 Linking another wallet

1. Account sheet → Wallets → **Link another wallet**. This is the chooser, with both kinds on the web and
   only Mera on the phone. On the phone a second Mera wallet means a second passkey, which is
   rare but allowed.
2. It is the same nonce and sign ceremony. The page calls `POST /v1/auth/wallet/link` with the session
   already present (`wallet-auth.ts:118`).
3. `409 ADDRESS_TAKEN`: "This wallet already belongs to another Pickler account. Sign in with it to
   use that account." Nothing moves.
4. `409 WALLET_LIMIT`: "An account holds up to 5 wallets. Remove one first."

**A studio account and a Mera wallet (cross-review G6).** A studio account cannot link a Mera wallet in
v1. Mera never appears on the studio host (conventions.md), and the marketplace has no email sign-in,
so no screen ever holds a studio session and a Mera signer at once. Someone who has both has two
accounts: the studio one (email + passkey) and the marketplace one (wallet). A cross-host link code,
issued in the studio and redeemed by a signed-in marketplace wallet that has no reads, follows or
handle yet, is the v2 answer. It is not built here, because it is an account merge in all but name
(D10).

### 3.5 Switching and unlinking

- **Switch.** The account menu lists linked wallets with kind and label. Picking one asks that
  wallet to connect (the extension for an EOA, a biometric for Mera). When the connected address is
  linked to the session's user, the session is reused (D12). When it is not linked, the person is
  asked "Sign in with this wallet, or link it to this account?".
- **Unlink.** Wallets → a row → Remove. A confirmation sheet names the address and says that the
  wallet's on-chain holdings stay in the wallet and only stop showing in this account. It calls
  `DELETE /v1/auth/wallet/links/:id`. A wallet-only account's last wallet has no Remove (D11).
- **Label.** Wallets → a row → Rename. At most 32 characters, stored on the link (`PATCH`).

### 3.6 Signing requests, per wallet

Every signature opens Pickler's confirmation sheet (D14). There are three request types in v1.

| Request                                | What the sheet shows                                                                                                                                             | Mera (web)                                                                                                                                          | EOA (web)                                                                                      | Mera (phone)                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Sign in** (SIWE, EIP-191)            | "Sign in to Pickler as 0xAB…CD. This proves the wallet is yours. It costs nothing and moves nothing." The raw message is behind "Show message".                  | `getPasskeyPrfOutput` → `signMessage` → drop                                                                                                        | `personal_sign` through the extension                                                          | the same as the web; may reuse a live 5-min session |
| **Pay for a read** (AUSD `transfer`)   | the agent, the question, the price in AUSD, the recipient "Pickler read treasury" with its address, chain "Monad testnet", estimated gas in MON, the refund rule | the page builds `transfer(treasury, amount)` from the payment intent of `paid-reads-v1.md` §4.3, then `signTransaction`, broadcasts, posts the hash | `eth_sendTransaction` with the same fields. The extension shows its own screen after Pickler's | the same as the web                                 |
| **Trade a token** (launchpad buy/sell) | the token, the side, the amount in and the minimum out, slippage, the contract "Pickler launchpad", gas                                                          | the same as a payment, with the `tx` (and `approval`) of the `token-trading-v1.md` quote                                                            | `eth_sendTransaction`                                                                          | the same as the web                                 |

Every transaction comes from the API: the payment intent of `paid-reads-v1.md` (token, treasury,
amount) or the trade quote of `token-trading-v1.md` (`tx`, `approval`). The page adds nothing of its
own. For a read it encodes exactly `transfer(intent.to, intent.amount)`, and for a trade it signs the
quote's calldata unchanged, in the same way that it never composes a SIWE message
(`lib/connect.ts:31-35`). Before signing, the page checks the quote's `to`, `value`,
`chainId` and decoded amount against what the sheet displayed, and refuses on a mismatch
(`SIGNING_MISMATCH`).

After the broadcast the sheet shows "Sent · waiting for Monad" with the hash. It turns into the
owning feature's state (read `IN WINDOW`, trade filled) when the API confirms. It never shows a
charge that the chain has not confirmed (see memory: never fake a charge).

## 4. API

All routes sit under `/v1/auth/wallet`, which `workers/api/src/app.ts:59` mounts. New error codes
follow conventions.md (`SCREAMING_SNAKE`). The existing lower-case codes (`nonce_invalid`,
`wallet_account_conflict`, …, `wallet-auth.ts:37-66`) stay until the envelope migration, which is
tracked outside this spec, so that today's web client keeps working.

| Method | Path                | Auth                | Request                                                          | Response `data`                                                                              | Errors                                                                                                         |
| ------ | ------------------- | ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| POST   | `/nonce` (changed)  | none                | `{ address, chain_id, client?: "web" \| "ios" \| "android" }`    | `{ nonce, message }` (unchanged)                                                             | 400 `invalid_address`, `invalid_chain`; 429 `NONCE_RATE_LIMITED` (limits per `operations-v1.md` §4.1)          |
| POST   | `/verify` (changed) | none                | `{ raw, signature, kind?: "mera" \| "eoa" }` (default `"eoa"`)   | `{ userId, session: { accessToken, refreshToken, expiresAt }, link: { id, kind, created } }` | as today, plus 400 `INVALID_WALLET_KIND`. The link cap does not apply: a sign-in always resolves to the holder |
| POST   | `/link` (changed)   | Bearer, user        | `{ raw, signature, kind?: "mera" \| "eoa" }`                     | `{ linked: true, link: WalletLinkDto }`                                                      | 400 `INVALID_WALLET_KIND`, 409 `ADDRESS_TAKEN`, 409 `WALLET_LIMIT`                                             |
| GET    | `/links` (changed)  | Bearer, user        | none                                                             | `WalletLinkDto[]`, ordered by `lastSignedInAt` desc                                          | 401                                                                                                            |
| PATCH  | `/links/:id` (new)  | Bearer, user, owner | `{ label: string \| null }` (1-32 chars after trim)              | `WalletLinkDto`                                                                              | 400 `INVALID_LABEL`, 404 `LINK_NOT_FOUND`                                                                      |
| DELETE | `/links/:id` (new)  | Bearer, user, owner | none. `Idempotency-Key` is not needed (the delete is idempotent) | `{ removed: true }`                                                                          | 404 `LINK_NOT_FOUND`, 409 `LAST_WALLET`                                                                        |

`WalletLinkDto` (in `packages/api-schema`, a new `wallets.ts`):
`{ id, namespace: "eip155", address, kind: "mera" | "eoa", label: string | null, verifiedChain, createdAt, lastSignedInAt: string | null }`.

`verify` and `link` take `kind` from the request body. It sits outside the signed message and cannot
be verified, which is acceptable only because it grants nothing (D9). The core port type
`kind: "external" | "mera"` (`packages/core/src/features/identity/ports/wallet-identity.ts:8`) and the
store's reader (`packages/infrastructure/src/persistence/wallet-identity-store.ts:36`) become
`"eoa" | "mera"`, and the two hard-coded `"external"` writers (`wallet-sign-in.ts:226,245`) pass the
request's kind.

Refreshing a session is **not** a Pickler route. The client calls Supabase's token endpoint through
supabase-js with the `refreshToken` from `verify`, as the web's shared client already does.

## 5. Data model and migrations

One migration, **`wallet_links_kind_and_labels`** (number assigned at build time; the next free number
is 0023), generated through Drizzle in `packages/infrastructure`:

- `identity.wallet_links`:
  - add `label text null`, `check (label is null or char_length(label) between 1 and 32)`
  - add `last_signed_in_at timestamptz null`, set by `verify` for an existing link
  - add `created_by_client text null`, `check (created_by_client in ('web','ios','android'))`
  - `kind`: `update ... set kind = 'eoa' where kind = 'external'`, default `'eoa'`, and the check
    `wallet_links_kind` (`identity.ts:124`) becomes `kind in ('eoa','mera')`. The migration and the
    code that writes `'eoa'` deploy together. If the API cannot deploy in the same window, the check
    first allows all three values, and a second migration (`wallet_links_kind_eoa_only`) tightens it.
- `identity.siwe_nonces`:
  - add `client text null`, and nothing else. The per-client nonce cap and its `client_hash` column
    belong to `operations-v1.md` (O7, conventions decision 16).

The backfill turns every existing link into `eoa`, which is true because no Mera link was ever
written.

The link cap (D10) and last-wallet rule (D11) live in core (`wallet-sign-in.ts`), which counts links
inside the same transaction as the insert and reads `pickler_account` and the login identities
through the existing `WalletAccounts` port.

**Wallet sign-in creates the profile row (cross-review D5).** `verify` makes sure that every account
it signs in has an `identity.profiles` row. It inserts `(user_id)` with `on conflict do nothing` in the
same transaction as the link, so a returning sign-in is a no-op and a studio account's existing row is
untouched. The row carries what other specs attach to a person before any handle exists:
`paid-reads-v1.md`'s notification email columns and the account that `public-record-v1.md`'s follows
reference. A second migration in this spec, **`profiles_handle_optional`**, therefore relaxes the table
(`identity.ts:36-49`):

- `handle` and `display_name` become nullable. The format and length checks apply only when they are
  not null. `profiles_handle_key` stays unique, and in Postgres several nulls do not collide.
- The handle claim (`POST /v1/profile`, `ProfileRepository.create` at
  `packages/infrastructure/src/persistence/profile-repository.ts:41`) becomes "set the handle and
  display name on the caller's row where the handle is null". It still refuses a second claim, and it
  inserts the row itself for a studio account that has none.
- Readers that assumed a handle (the persona, directory and account screens) treat null as "no handle
  yet", and show the short address, as the account menu does today.

## 6. Integrations

| System                      | Use                                                                  | Config                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@category-labs/mera` 0.2.x | web signer (`apps/web` dependency only; never in core or api-schema) | `NEXT_PUBLIC_MERA_RP_ID=app.pickler.fun`, `NEXT_PUBLIC_MERA_WEB=on\|off` (default off)                                          |
| Injected EIP-1193 wallet    | unchanged                                                            | none                                                                                                                            |
| Monad RPC                   | Mera broadcast and receipt polling from the page                     | the public RPC in `@pickler/chain`. A private RPC URL never reaches the web                                                     |
| Supabase Auth               | session minting (`wallet-accounts.ts:220-244`), refresh              | refresh token rotation on; inactivity timeout 30 days (Supabase "Sessions" settings, owner's dashboard)                         |
| API                         | nonce, verify, link                                                  | `SIWE_DOMAIN=app.pickler.fun`, `WALLET_EMAIL_DOMAIN` (unchanged); rate limits and `RATE_LIMIT_SALT` per `operations-v1.md` §4.1 |

`apps/web/public/_headers` gains the CSP from D6 for the marketplace host. Its line 4 still says
"relying party pickler.fun" and gets corrected in the same change.

## 7. Design work

All of this is on the **marketplace web** light surface, except where a row says otherwise. None of
these screens has a canvas yet. The chooser exists in code (`connect-modal.tsx`) with no canvas
behind it.

| Screen                       | Surface         | States                                                                                                                         | Canvas                                                                        |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Wallet chooser v2            | marketplace web | Mera first (create / I have one), browser wallet; either one unavailable with its reason; holding an action; connecting; error | **draw** "Pickler Wallet Chooser" in the design project                       |
| Mera create / sign-in        | marketplace web | waiting for passkey, deriving, signing, done, cancelled                                                                        | same canvas                                                                   |
| PRF unavailable              | web and mobile  | web: fix list plus "Use a browser wallet"; mobile: fix list only                                                               | same canvas, plus a mobile frame in the existing mobile flows                 |
| Confirmation sheet           | web and mobile  | sign in / pay for a read / trade; mismatch refused; needs MON for gas; sent, waiting; confirmed; failed                        | **draw** "Pickler Signing Sheet"                                              |
| Account sheet → Wallets      | marketplace web | one wallet (empty state), several wallets, rename, remove confirm, last-wallet (no Remove), link another, limit reached        | **draw**, as a section of the marketplace account sheet (product-hosts-v1 §5) |
| Account menu → switch wallet | marketplace web | linked wallets list, current wallet, "sign in or link?" prompt for an unlinked address                                         | same canvas as Wallets                                                        |
| Mobile wallet screens        | mobile          | onboarding create/restore, wallets list, signing sheet                                                                         | extend the existing mobile flows canvas (design-system-v2 §8)                 |

`scripts/design/routes.mjs` gets a route per new screen, with a `proves` selector: the chooser with
Mera present, Wallets with one link and with three links, and the signing sheet in each of its three
types, fed by fixtures.

## 8. Security and abuse

### 8.1 A key in the page: the risk, the mitigation, and what remains

**The risk.** `product-hosts-v1.md` §2 (lines 65-72) made the web EOA-only for one reason: Mera's
key is derived from the passkey's PRF output into the memory of the process that signs. In a web page
that process is the page, which it shares with every script the page loads, every script an XSS bug
lets in, and every browser extension with access to the host. Anything running there during a
ceremony can sign with the key, or copy the PRF output and derive it again later. The PRF output is
deterministic, so a leaked output is a leaked wallet forever, on the phone too. An injected EOA keeps
its key in the extension, outside the page. The owner's rule puts Mera on the web anyway, so this
spec reduces the exposure rather than removing it.

**Mitigation, v1 (launch):**

1. **Per-ceremony derivation, memory only (D5).** One biometric per sign-in, payment or trade. The
   PRF output and the key live in local variables of one async function and are dropped when it
   returns. Nothing enters React state, storage, logs or error reports. There is no long-lived Mera
   session on the web.
2. **Strict CSP and no third-party scripts on `app.pickler.fun` (D6).** Nonce-based `script-src`,
   `require-trusted-types-for 'script'`, `object-src 'none'`, `base-uri 'none'`, and a
   `frame-ancestors 'none'` that stops the marketplace being framed. No analytics, tag managers or chat
   widgets on the marketplace host. The chart library is self-hosted.
3. **The Mera SDK is loaded lazily**, from the same origin, only when a ceremony starts, and is pinned
   by the lockfile and SRI.
4. **The host split (D3/D4):** no other Pickler origin sits inside the relying party's scope, and the
   studio (Turnkey) is a different host.

**Hardening, v1.1 (recommended): a signer iframe on a dedicated origin.** The ceremony moves into an
iframe served from `sign.app.pickler.fun`: a page that carries only the Mera SDK and a `postMessage`
protocol (the request in, the signature or hash out), under a CSP stricter still. A subdomain of the
relying party may assert with `rpId: "app.pickler.fun"`, so addresses do not change. The embedding page
grants `allow="publickey-credentials-get; publickey-credentials-create"`. XSS on the marketplace page
can then ask for a signature, which the iframe shows in its own confirmation UI, but it can never read
the key. It is not in v1 because PRF in cross-origin iframes has to be confirmed on Safari, Chrome and
Firefox first (acceptance item 8).

**What remains.** A malicious extension with access to the host can read any frame, the signer
iframe included. So can a compromised device. Neither is solvable in a web page. For those, the
fallback is the phone app or an EOA. Accepting this residual risk is an owner decision (§12 question 2).

### 8.2 Other risks

- **Key in the page (D5, D6).** The PRF output and the derived key are local variables inside one
  async function. `toViemAccount` is created, used and dropped. No Mera value enters React state,
  context, logs, error reports or storage. A unit test with a spy on `Storage.prototype.setItem`
  proves that nothing is written during a ceremony.
- **Shared picker.** Enforced by D3/D4: the build check, and `hosts.ts` without the
  `app.pickler.fun` studio fallback (`product-hosts-cutover-v2.md` H2).
- **Kind spoofing.** `kind` grants nothing (D9). A test asserts that no branch in core or the
  API reads `kind` except the DTO mapper.
- **Nonce flooding.** Owned by `operations-v1.md` (O7 and the §4.1 table: `RL_AUTH` per client, at
  most 20 open nonces per `client_hash` under `RATE_LIMIT_SALT`). This spec adds no limit of its own.
  The refusals happen before anything is stored, as today (`wallet-sign-in.ts:190-209`).
- **Session reuse across wallets (D12).** Reuse happens only when the connected address is in the
  session user's link list, and that list is fetched from `/links` on the server, never cached across
  users. A switch to an unlinked address drops the token before asking.
- **Transaction integrity.** The page compares the quote to the displayed summary (§3.6). The API
  verifies the transfer on chain (`paid-reads-v1.md` §4.3, `TX_MISMATCH`). Nothing is trusted from the page but a hash.
- **Account takeover by linking.** Linking needs a session and a fresh signature from the new wallet.
  An address held by another account is refused, never moved (`wallet-sign-in.ts:237-239`).
- **Phishing of the sign-in message.** The message names `app.pickler.fun` (`SIWE_DOMAIN`). The sheet
  shows the domain in words.

## 9. Acceptance criteria and tests

1. Core: `wallet-sign-in` writes `kind: "mera"` when the nonce carried it, keeps the first kind on
   a second sign-in, refuses a 6th link (`WALLET_LIMIT`), and refuses to remove a wallet-only
   account's last link (`LAST_WALLET`), all against fake ports.
2. Infrastructure: the migration applies on an empty database and on a 0022 database. The
   `wallet-identity-store` test round-trips `label`, `last_signed_in_at` and `created_by_client`.
3. API: the routes in §4 return the listed codes (`workers/api/test/wallet-auth.test.ts`
   extended). A PATCH or DELETE of someone else's link answers 404, not 403.
4. Web unit: `decideSession` reuses a token for a linked address and signs for an unlinked one. The
   Mera signer writes nothing to storage. A PRF-less credential surfaces `MERA_PRF_UNAVAILABLE`.
5. Web build: `NEXT_PUBLIC_MERA_WEB=on` with the host variables unset fails the build.
6. Design harness: the new routes pass `npm run design:check`.
7. **Manual, on staging, recorded in a dated doc:** create a Mera wallet in Safari (iCloud Keychain),
   sign in, link a MetaMask wallet, switch between them without a second SIWE, sign in with the same
   passkey on the phone app, and see **the same address** (proves D2 across surfaces).
8. **Signer iframe feasibility (v1.1):** a PRF create and get from an iframe on `sign.app.pickler.fun`
   embedded in `app.pickler.fun`, in Safari, Chrome and Firefox, returns the same address as the
   top-level ceremony. Recorded in the same doc.

## 10. Rollout and dependencies

1. **Needs first:** `product-hosts-cutover-v2.md` (three hosts, DNS, the AASA host rule,
   `hosts.ts` without the `app.pickler.fun` studio fallback), and `TURNKEY_RPID=studio.pickler.fun`
   on every deployed environment. Addresses that TestFlight testers derived under `pickler.fun` move
   through the "Move your funds" flow of `mobile-backend-v1.md` (conventions decision 14). The web
   never had a Mera user, so it has nothing to migrate.
2. The migration and API changes can ship before the web signer. They are backwards compatible
   (`kind` defaults to `eoa`).
3. The web Mera signer ships behind `NEXT_PUBLIC_MERA_WEB=off`, and is turned on after acceptance
   item 7.
4. `paid-reads-v1.md` and `token-trading-v1.md` provide the intents and quotes that §3.6 signs. Until
   they exist, only the sign-in request type ships.
5. The same change amends every document that contradicts the owner's rule (research 05 §7.2):
   - `product-hosts-v1.md` §1 (line 24, "On the web an injected EOA; on the phone Mera"), §2
     (lines 65-72, the reason the web was EOA-only) and §7 "Mera on the web" (line 247): Mera is
     the web's primary wallet, and §8 of this spec answers the risk that §2 names.
   - `apps/web/AGENTS.md:78` ("Nothing in this app derives or holds a private key, and no new signer
     may"; "the person's own Pickler wallet … is custodied in Turnkey"): the Mera signer may derive a
     key for one ceremony under D5/D6, and the Turnkey master wallet is the studio's, not the
     marketplace's.
   - The comment at `apps/web/src/features/wallet/lib/signer.ts:9-11`, which says the same thing, and
     `SignerKind`, which gains `"mera"`.
   - `turnkey-passkey-custody-v1.md` §6 "The PRF signer is retired": the retirement was about the
     shared relying party `pickler.fun`, not a ban on Mera.
   - `docs/market/token-launch.md` product-split table (line 15): "Mera in the app and on the web, an
     external wallet on the web only".
   - `user-profiles-and-products-v1.md` §13 "What this means for the plan" ("Mera is a second
     connector … the marketplace can ship on EOAs"): Mera is the primary wallet, and the EOA is the
     fallback.

## 11. Out of scope

WalletConnect; ERC-1271 and smart accounts; Solana (`siws`); sponsored gas; account merge; a Mera
export or backup screen (Mera supports export; v2); hardware-wallet-specific UX; Turnkey in any
marketplace flow.

## 12. Open questions for the owner

1. **The phone app's key model.** D2 assumes the TestFlight app uses the PRF model. If it uses the
   vault model, web and phone give the same passkey different addresses. Which model does the app
   use? (Research 05 open question 1; PR #33 asked and got no answer.)
2. **Accepting the key-in-page risk (§8.1).** Do you accept the residual risk of Mera on the web
   under D5/D6: a malicious extension, or script injected into `app.pickler.fun`, could use the key
   during the seconds of a ceremony? **Recommendation: accept**, with D5/D6 at launch and the signer
   iframe on `sign.app.pickler.fun` as the first hardening once browser support is confirmed. The
   stricter alternative is no Mera on the web, which contradicts your rule.

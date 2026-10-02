# Mera on the web v1: a passkey wallet or a browser wallet, one account either way

Status: approved by the owner on 2026-10-01, in conversation. Scope: connect and sign in; sending
transactions from the web is a later specification. Branch `codex/mera-web`, stacked on
`codex/perpl-board-live` (#73) and through it on `codex/mobile-monorepo` (#71).

## 1. Problem

The marketplace has one wallet rule (`docs/specs/mobile-monorepo-v1.md`): Mera, the passkey
wallet, on the phone and on the web, with a browser wallet (an EOA) as the web's alternative. The
phone does that. The web offers only the browser wallet: its Mera signer was retired on 2026-09-22
because it shared a relying party with the studio's Turnkey passkeys, and it never signed
anything — it derived an address, with a rule that gave a different address from the app's.

Three things are also missing whichever wallet is used:

1. Connecting does not sign in. The session a wallet account needs is asked for later, by whatever
   first needs it, and nothing on the web does yet.
2. Nobody is asked for a username. The panel that asks exists
   (`features/wallet/components/claim-handle.tsx`) and is shown only by the design preview.
3. The server cannot say which kind of wallet a person linked: both writers store `external`.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reversible?                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| M1  | **The chooser offers two wallets, and only two:** the passkey wallet (Mera), first, with "Create one" and "I already have one"; and the browser wallet, as today. Turnkey is never offered here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | yes                            |
| M2  | **Mera's relying party on the web is `pickler.fun`**, the same as the app's (`mobile-monorepo-v1.md` W1). The same passkey, synced by its keychain, is the same account on both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | no, once anyone holds funds    |
| M3  | **The account is derived by `@pickler/mera-account`** and by nothing else: PRF output → BIP-39 → `m/44'/60'/0'/0/0`. The retired signer's rule (the PRF output as the key) is not brought back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | no, same reason                |
| M4  | **No key is kept.** A passkey prompt yields the PRF output; the key is derived, used to sign once, and its bytes zeroed before the signature is presented. Nothing derived from it is stored. Every later signature is another prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | yes                            |
| M5  | **Connecting signs in, for both wallets.** After the wallet connects, the chooser goes on to one signature over the server's sign-in message. For Mera that is the same ceremony as connecting: one prompt. For a browser wallet it is its own step with its own button, then the wallet's prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes                            |
| M6  | **Then a username, and it is not optional** (owner, 2026-10-02; it was closable before). Whatever wallet signed in, an account with no profile is asked for its username in the chooser's last step, and a wallet that connected finishes arriving or is disconnected: the sign-in, username and link steps have one way out that is not forward, **Disconnect**. Escape and a click outside do nothing there; Disconnect works even while a wallet is being asked to sign, so one that never answers holds nobody. On load a remembered wallet is picked up only if the browser still holds a session, so a reload does not leave a wallet connected without an account. An account found without a username when no chooser is open — after a reload — is asked again at once, on any marketplace page. Only an account known to have none is held: a profile that could not be read holds nobody. | yes                            |
| M7  | **The server records the kind.** `POST /v1/auth/wallet/verify` and `/link` accept `kind: "mera" \| "eoa"` (default `eoa`), stored in `identity.wallet_links.kind` as `mera` or `external`. It describes; it grants nothing. The first writer stands. No migration: the column already allows both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes                            |
| M8  | **What the browser remembers** is the kind, the address and the passkey's credential id. A reload shows the address without a prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | yes                            |
| M9  | **Mera and Turnkey are kept apart five ways** (§4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                              |
| M10 | **A passkey that returns no PRF output is a named state**, not an error box: the chooser says which password managers work and offers the browser wallet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | yes                            |
| M11 | `NEXT_PUBLIC_MERA_WEB=off` removes the passkey wallet from the chooser. It is the switch to pull if the key-in-page exposure of §5 is ever judged too high.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | yes                            |
| M12 | **A new wallet can join the account the person already has** (§9). The username step offers it; the other wallet signs once; the bare account the new wallet was given is folded into the existing one. It is the only way an address changes account, and only a bare account with no username is ever given up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | no, for an account once joined |

## 3. The flow

```
choose ──► connect ──► sign in ──► username? ──► done
                                      └─ or join the account you already have (§9)
           Mera:  one passkey prompt covers connect and sign in
           EOA:   the wallet's account prompt, then "Sign in" and its signature prompt
```

1. **Choose.** "Passkey wallet" (Create one · I already have one) or "Browser wallet". What the
   person was about to do stays on the card, as today.
2. **Connect and sign in.**
   - _Mera, create:_ `createPasskeyWithPrfOutput({ rp: { id, name: "Pickler" }, user })` — one
     prompt, a new passkey and its PRF output.
   - _Mera, existing:_ `getPasskeyPrfOutput({ rpId })` — one prompt; the platform offers the
     person's Pickler passkeys, the app's included.
   - Either way the ceremony continues without another prompt: derive the address, ask the API for
     the sign-in message (`/nonce`), sign it, present it (`/verify`, `kind: "mera"`), zero the key.
   - _Browser wallet:_ `eth_requestAccounts`, then the step "Sign in as 0xAB…CD" whose button asks
     for `personal_sign` and presents it with `kind: "eoa"`.
3. **Username.** With the session, `GET /v1/profile`. A 404 opens "Pick your username": the field,
   the availability check and the claim that `claim-handle.tsx` already has, now a shared hook.
   The claim uses the session; nothing is signed again. The step cannot be closed: the person
   picks a username, links the wallet to the account they already have (§9), or disconnects.
4. **Done.** The chooser closes and the action that was held continues.

Signing in again later (the session expired) is `signInWithWallet`, as today. For Mera it runs a
ceremony restricted to the remembered credential and refuses a passkey that derives another
address.

## 4. Mera and Turnkey never meet

| Guard         | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relying party | Mera asks WebAuthn for `pickler.fun`, a constant in the code and not configuration; Turnkey's passkeys are enrolled against `app.pickler.fun`. A browser never offers a credential for a relying party that was not asked for, so the passkey wallet cannot be opened with a studio passkey. The API already refuses to compose custody on Mera's relying party.                                                                                                          |
| Host          | The passkey wallet is offered only where the page's hostname is the relying party and is the host configured as the marketplace. On the studio host it is unavailable, with the reason, even though WebAuthn would allow the parent domain there. A host that is neither — a preview, a staging host, where both products answer — has no passkey wallet until a specification gives it one.                                                                              |
| Code          | ESLint: nothing under `features/wallet` may import `@turnkey/*` or anything of `features/auth`, `features/studio` or `features/account` but the Supabase client; nothing outside `features/wallet/lib/mera-*.ts` may import `@category-labs/mera` or `@pickler/mera-account`; nothing outside `features/wallet` may import those modules. Static imports and `import()`. CI fails on any. A re-export through another wallet module is not something a lint rule can see. |
| Account       | A wallet sign-in account is marked `pickler_account = "wallet"` and claims its username without a custody account, as the API already allows. A studio account's Turnkey wallet is never listed, linked or signed with here. `kind` describes a link and decides nothing.                                                                                                                                                                                                 |
| Development   | On `localhost` both relying parties are necessarily `localhost`, so a studio passkey made there can be picked in the passkey wallet's prompt and would derive an account. On a deployed host the two rows above prevent it. Locally the chooser says so on the choice, and the account derived there is not the app's in any case.                                                                                                                                        |

## 5. A key in the page

In the app the derived key lives in the app's process. On the web it lives in the page, beside
every script the page runs and every extension allowed on the host, for as long as it exists. M4 is
the mitigation in this version: the PRF output is zeroed as soon as the key is derived, the key
lives in local variables across one request (the sign-in message, which needs the address) and is
zeroed before the signature is presented, in a `finally`. The derivation wipes every HD node it
went through. The Mera SDK and the derivation are fetched when the chooser opens, not with the
page, so that the passkey prompt follows the click without a download in between.

What zeroing cannot reach: the mnemonic is a string, the curve and derivation libraries compute
with big integers and temporaries of their own,
and the browser keeps its own copy of the PRF output in the credential it returned. They are
unreachable after the ceremony and are the garbage collector's. "No key is kept" means nothing
reachable holds one.

What this does not cover: a malicious script already in the page during a ceremony can use the key
or copy the PRF output, and a PRF output is the wallet for good, on the phone too. A strict
content-security policy for the marketplace host and a signer isolated in its own origin are the
next two steps (`marketplace-wallets-v1.md` §8.1, draft in #65) and are **required before mainnet
funds**; today the venue is a testnet. M11 is the switch if the owner decides otherwise sooner.

## 6. What changes

- **Core and API.** `verify` and `link` take the kind (M7); an unknown kind is 400
  `invalid_wallet_kind`.
- **`features/wallet/lib/mera-ceremony.ts`** — the ceremony with its parts injected (the PRF
  source, the derivation, `fetch`), so it is tested without a browser: it derives the vector
  addresses, signs exactly the server's message, zeroes what it derived whatever happens, and
  refuses a passkey that is not the connected account.
- **`features/wallet/lib/mera-signer.ts`** — the `SignerAdapter` for the browser: where it may be
  offered (`meraAvailability`, pure), what it remembers, the balance over the public RPC of
  `@pickler/chain`.
- **`features/wallet/lib/connect-flow.ts`** — the chooser's steps as a pure reducer.
- **`wallet-context.tsx`** — signing in goes through the connected adapter instead of assuming the
  injected provider; connecting runs the flow of §3.
- **`connect-modal.tsx`** — the steps; `lib/use-handle-claim.ts` is the username form's logic,
  shared with the portfolio's panel. The account menu names the wallet kind. The portfolio asks for a username from
  the real condition (a session and no profile), not only in the preview.
- **`eslint.config.mjs`** — the code guard of §4.
- **Documents.** `apps/web/AGENTS.md` (the wallet section is rewritten: the rule "no signer derives
  a key" is replaced by M4), `workers/api/AGENTS.md`, `packages/core/AGENTS.md`,
  `packages/mera-account/AGENTS.md` (a second consumer).
- **Design harness.** A door outside production, `?wallet=choose|signin|username|prf`, opens the
  chooser on a step, and `scripts/design/routes.mjs` gets a route for each.

## 7. Acceptance

1. The ceremony derives the addresses of `@pickler/mera-account`'s vectors from their PRF outputs,
   and the signature it presents recovers to that address over the server's exact message.
2. After a ceremony — finished, refused by the server, or thrown — the PRF output and the key it
   was given are zero-filled; the PRF output already when the first request leaves, the key before
   the signature is presented. Nothing is written to storage but the kind, the address and the
   credential id (seen in a browser, not pinned by a unit test).
3. `meraAvailability`: offered on `pickler.fun` when it is the configured marketplace host;
   refused on the studio host, on any other host — one that serves both products included — and
   with the switch off; on `localhost` outside production, offered with the development note.
4. The API stores `mera` for a Mera sign-in and `external` otherwise, keeps the first kind on a
   second sign-in, and refuses an unknown kind.
5. The flow: Mera reaches "signed in" in one step; a browser wallet passes through "sign in"; an
   account without a profile reaches "username" and one with a profile does not.
6. ESLint fails on a Turnkey import under `features/wallet` and on a Mera import under
   `features/auth`, `features/studio` or `features/account` (proved once by a test that lints two
   offending snippets).
7. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` and the
   design checks pass.
8. **Not verifiable here, and said so in the pull request:** that a passkey made in the app opens
   the same address on `pickler.fun` in a browser. It needs the deployed host, a real synced
   passkey, and the signing API reachable there. The vectors prove the rule is the same; the
   relying party is the same by configuration.

## 8. Out of scope

Sending a transaction from the web (paying for a read, trading, enabling Perpl); the
content-security policy and the isolated signer (§5); adding a wallet from inside an account that
already has a username, switching between an account's wallets, unlinking, and merging two accounts
that both have usernames (`marketplace-wallets-v1.md` D10–D12); joining with a second account of
the same browser wallet; WalletConnect; a Mera export screen. The mobile app's sign-in to the same
account, with the same mandatory username, is its own specification:
`docs/mobile/superpowers/specs/2026-10-02-mobile-account-design.md`.

## 9. Joining the account you already have

Added on 2026-10-02, at the owner's request: the wallet is the way in, and somebody who is already
in under one wallet must be able to come in under the other.

**The problem.** Connecting signs in, and a first sign-in makes an account (M5). So a person with
an account under their passkey wallet who connects their browser wallet gets a second, empty
account, and is asked for a username as if they were new.

**The flow.** The username step has a second way out: "Already have a Pickler account? Link this
wallet to it".

```
username ──► join ──► joined ──► closed
   ▲           │
   └── Back ───┘
```

1. **Join.** The person picks the wallet their account is under: the passkey wallet ("I already
   have one" — there is nothing to create) or the browser wallet. That wallet signs the server's
   sign-in message, as it would to sign in: one prompt.
2. The signature goes to `POST /v1/auth/wallet/join` with the session of the account the connected
   wallet was just given. The API moves the connected wallet to the account of the wallet that
   signed, removes the empty account, and answers with a session for the account that is kept.
3. **Joined.** "0xAB…CD now opens @username." The connected wallet stays connected; the page holds
   the kept account's session. If that account has no username either, the username step is shown
   for it instead.

**What the server requires**, because this is the one place an address changes account:

| Side                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The account kept     | A signature of its wallet over a fresh nonce, in a message that is not the sign-in message: its sentence is `Link wallet <address> to this wallet's Pickler account`, naming the wallet being let in (`POST /v1/auth/wallet/nonce` with `joining`). `join` accepts it only for that wallet, and `/verify` and `/link` refuse it (400 `wrong_purpose`), as `join` refuses a sign-in message. A browser wallet shows the sentence before it signs. Without this proof anybody could attach their wallet to somebody else's account. |
| The account given up | Its session, which is the caller's. It must have **no username**, **no custody (Turnkey) wallet**, hold **exactly one wallet**, and be the bare account wallet sign-in made for that wallet — never an email or Google account that linked one. Anything else: 409. The statement that moves the wallet holds the one-wallet and no-username conditions again, so a second join or a username claimed in between moves nothing (409 `join_changed`).                                                                              |

`POST /v1/auth/wallet/link`, which adds a wallet to the signed-in account, still refuses an address
that belongs to another account. Joining gives an account up; linking never takes one.

**Refusals, each with words on the join step:** the wallet that signed has no account
(`no_account`); it is the connected wallet itself (`same_account`); the connected wallet's account
has a username (`join_has_profile`) or a custody wallet (`join_has_custody`); it is not a bare
wallet account (`join_not_wallet_account`); it changed while it was being joined (`join_changed`).
A closed prompt is not a refusal.

**When the answer is lost.** The join request can leave and never be answered: a timeout, or the
server failing after it moved the wallet. Only that — a request that was sent — counts; a wallet
prompt or a challenge that failed moved nothing. The page then cannot know which account the
connected wallet opens, so it lets go of the session it held, says the link may already have
happened, and on the next try signs in as the connected wallet again. That sign-in says which
account the wallet opens now: if it is no longer the one that was being given up, the join
happened, and the page says so without asking the other wallet to sign again.

**After a reload.** The page finds the account without a username and shows the username step
again, with the same link. It holds no session it can use by then, so choosing to link opens a
step that says the connected wallet confirms itself first, and only then asks for the other
wallet.

**Limits.**

- The conditions on the account given up are held in the statement that moves its wallet, which
  closes two joins of one account at once. A username claimed for that account, or the kept
  account being given up itself, in the very instant of that statement can still slip past: they
  are writes to another table and another row. Each needs the same person in two requests at once
  and none reaches another person's account. Closing them takes an advisory lock shared with
  profile creation.
- A second account of the same browser wallet cannot sign from the join step: selecting it in the
  extension is the wallet changing under the page, which the page follows as a new connection.
- Two accounts that both have usernames are not merged.
- The account given up agrees with its session, a bearer token. Somebody holding a stolen session
  of a bare account could move that wallet into an account of their own — the same class as
  `/link`, which lets a stolen session add a wallet for good. Before mainnet funds the join should
  take a signature of the moving wallet too. The kept side's consent is already bound to its
  purpose and to the one wallet it lets in.
- The token of the account given up is accepted by the API until it expires, as a JWT is. On
  Supabase the foreign keys to `auth.users` refuse what it would write. This page stops using it
  when the join answers; another tab holding it does not know.
- If removing the emptied account fails, it stays, without a wallet. Its session keeps refreshing
  until it is signed out, and it could still claim a username nobody can then reach by wallet.

**Acceptance.** Core: a bare account joins; a bad signature, a wallet with no account, the same
account, an account with a username or a custody wallet, a studio account and an account with two
wallets each move nothing; a move the store refuses hands out no session; a sign-in signature does
not join, a join signature neither signs in nor links nor lets another wallet in; `link` still
refuses a taken address. Store: `reassignSole` moves an account's one wallet and no other, moves nothing for
an account with a profile, with two wallets or with none, and moves once under four at once. Route: 401 without a session, the kept account's session on success, a code per refusal.
Web: the reducer's `join`, `joined` and `back`; the words for each refusal. In a browser, both
directions (new passkey wallet joins a browser wallet's account, and the reverse), two refusals,
and a join whose answer is lost and is found done on the next try.

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

| #   | Decision                                                                                                                                                                                                                                                                                           | Reversible?                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| M1  | **The chooser offers two wallets, and only two:** the passkey wallet (Mera), first, with "Create one" and "I already have one"; and the browser wallet, as today. Turnkey is never offered here.                                                                                                   | yes                         |
| M2  | **Mera's relying party on the web is `pickler.fun`**, the same as the app's (`mobile-monorepo-v1.md` W1). The same passkey, synced by its keychain, is the same account on both.                                                                                                                   | no, once anyone holds funds |
| M3  | **The account is derived by `@pickler/mera-account`** and by nothing else: PRF output → BIP-39 → `m/44'/60'/0'/0/0`. The retired signer's rule (the PRF output as the key) is not brought back.                                                                                                    | no, same reason             |
| M4  | **The key exists for one ceremony.** A passkey prompt yields the PRF output; the key is derived, used, and its bytes zeroed before the ceremony returns. Nothing derived from it is stored. Every later signature is another prompt.                                                               | yes                         |
| M5  | **Connecting signs in, for both wallets.** After the wallet connects, the chooser goes on to one signature over the server's sign-in message. For Mera that is the same ceremony as connecting: one prompt. For a browser wallet it is its own step with its own button, then the wallet's prompt. | yes                         |
| M6  | **Then a username, if the account has none.** Whatever wallet signed in, an account with no profile is asked for its username in the chooser's last step. Closing the chooser is always possible; the portfolio then asks again.                                                                   | yes                         |
| M7  | **The server records the kind.** `POST /v1/auth/wallet/verify` and `/link` accept `kind: "mera" \| "eoa"` (default `eoa`), stored in `identity.wallet_links.kind` as `mera` or `external`. It describes; it grants nothing. The first writer stands. No migration: the column already allows both. | yes                         |
| M8  | **What the browser remembers** is the kind, the address and the passkey's credential id. A reload shows the address without a prompt.                                                                                                                                                              | yes                         |
| M9  | **Mera and Turnkey are kept apart five ways** (§4).                                                                                                                                                                                                                                                | —                           |
| M10 | **A passkey that returns no PRF output is a named state**, not an error box: the chooser says which password managers work and offers the browser wallet.                                                                                                                                          | yes                         |
| M11 | `NEXT_PUBLIC_MERA_WEB=off` removes the passkey wallet from the chooser. It is the switch to pull if the key-in-page exposure of §5 is ever judged too high.                                                                                                                                        | yes                         |

## 3. The flow

```
choose ──► connect ──► sign in ──► username? ──► done
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
   The claim uses the session; nothing is signed again.
4. **Done.** The chooser closes and the action that was held continues.

Signing in again later (the session expired) is `signInWithWallet`, as today. For Mera it runs a
ceremony restricted to the remembered credential and refuses a passkey that derives another
address.

## 4. Mera and Turnkey never meet

| Guard         | What it is                                                                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relying party | Mera asks WebAuthn for `pickler.fun`; Turnkey's passkeys are enrolled against `app.pickler.fun`. A browser never offers a credential for a relying party that was not asked for, so the passkey wallet cannot be opened with a studio passkey. The API already refuses to compose custody on Mera's relying party.      |
| Host          | The passkey wallet is offered only where the page is the marketplace: its hostname is the relying party, and the product for that host is not the studio. On the studio host it is unavailable, with the reason, even though WebAuthn would allow the parent domain there.                                              |
| Code          | ESLint: nothing under `features/wallet` may import `@turnkey/*` or the custody and passkey modules of `features/auth` and `features/studio`; nothing outside `features/wallet/lib/mera-*.ts` may import `@category-labs/mera` or `@pickler/mera-account`. CI fails on either.                                           |
| Account       | A wallet sign-in account is marked `pickler_account = "wallet"` and claims its username without a custody account, as the API already allows. A studio account's Turnkey wallet is never listed, linked or signed with here. `kind` describes a link and decides nothing.                                               |
| Development   | On `localhost` both relying parties are necessarily `localhost`, so a studio passkey made there can be picked in the passkey wallet's prompt and would derive an account. That cannot happen on a deployed host. Locally the chooser says so on the choice, and the account derived there is not the app's in any case. |

## 5. A key in the page

In the app the derived key lives in the app's process. On the web it lives in the page, beside
every script the page runs and every extension allowed on the host, for as long as it exists. M4 is
the mitigation in this version: the key exists for the seconds of one ceremony, in local variables,
and is zeroed in a `finally`. The Mera SDK and the derivation are loaded when a ceremony starts,
not with the page.

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
   was given are zero-filled, and nothing was written to storage but the kind, the address and the
   credential id.
3. `meraAvailability`: offered on `pickler.fun`; refused on the studio host, on any other host and
   with the switch off; on loopback outside production, offered with the development note.
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
content-security policy and the isolated signer (§5); linking a second wallet, switching and
unlinking (`marketplace-wallets-v1.md` D10–D12); WalletConnect; a Mera export screen; SIWE from the
mobile app.

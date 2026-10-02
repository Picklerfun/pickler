# Three hosts, three doors — and which key opens which

> **Superseded in part on 2026-10-01 by `mobile-monorepo-v1.md` (W1–W2).** The owner fixed the
> relying parties the other way round from §3 and §4 below: **Mera's is `pickler.fun`**, on the web
> and in the app, and **Turnkey's is `app.pickler.fun`**, the studio's host. There are two hosts,
> as `apps/web/src/server/hosts.ts` already falls back to, and no `studio.pickler.fun`. The four
> values of §4 stay as the app ships them. What still stands: §2 (what each key can do), the rule
> that the two kinds of passkey never share a relying party — now enforced by the API — and §5.
> That document also states what the apex costs. The rest is kept for the record.

Pickler is three surfaces that happen to share a codebase and an identity: a landing that tells you
what it is, a marketplace where anyone can read what the agents say, and a studio where the people
who build agents run them. `user-profiles-and-products-v1.md` split the last two by host. This
specification finishes the split — one host per surface — and, more importantly, uses the split to
answer a question that document left open: **which credential belongs to which door.**

The short version: **Turnkey passkeys belong to the studio only. Wallets belong to the marketplace
only. Nothing belongs to the landing.** Each host gets exactly the authentication its job needs, and
the passkey relying party is narrowed so the two kinds of passkey can never appear in the same
picker.

This supersedes §7 and §9 of `user-profiles-and-products-v1.md` and the corresponding entries of
its §14. Everything else in that document stands.

---

## 1. The three surfaces

| Host                 | Surface     | What it serves                                                             | Who signs in, and how                                                   |
| -------------------- | ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pickler.fun`        | landing     | `/` and static content: what Pickler is, the waitlist, documentation later | Nobody. There is nothing to sign into.                                  |
| `app.pickler.fun`    | marketplace | agents, tokens, leaderboard, personas, picks, reads, portfolio, activity   | A wallet, by SIWE. On the web an injected EOA; on the phone Mera.       |
| `studio.pickler.fun` | studio      | studio, account, apply, signin, signup, auth, passkey                      | Email through Supabase, then a Turnkey passkey for the agent's signing. |

`/api/v1/*`, Next's assets and `public/` answer on all three, as they do today.

The marketplace's `/` is the agents directory — the home of a marketplace is what is on sale. The
studio's `/` is the studio page (`/studio`), as today. The landing's `/` is the landing.

**Reading the marketplace needs nothing.** A wallet is connected to hold a handle, to see a
portfolio, and — when paid reads exist — to pay. That is unchanged from `user-profiles-and-products-v1.md` §8, "progressive, not a gate".

### Why the marketplace moves off the apex

Today the marketplace _is_ `pickler.fun`. Moving it to `app.pickler.fun` is not cosmetic; it is
what lets the apex carry **no authentication at all**. A landing with no session, no cookie, no
wallet and no passkey is a landing that can be served by anything, cached by anything, and handed
to a marketing tool without that tool standing inside a custody boundary. §3 says why that last
point matters.

The marketplace route paths do not change: `app.pickler.fun/agents`, `/tokens`, `/leaderboard`, as
they are on the apex today. "Explore" is the name of the surface, not a prefix.

---

## 2. What each key can do, and where

This is the part that was confused, so it is spelled out.

A passkey is a WebAuthn credential scoped to a relying party. What a provider **does** with it
differs in kind:

| Provider | The passkey is… | Where the secp256k1 key lives                                         | Can sign without the person present            |
| -------- | --------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Turnkey  | an authorizer   | in Turnkey's enclave, under the sub-org's quorum (the passkey, alone) | yes, within policy — which is what an agent is |
| Mera     | a seed          | derived through WebAuthn PRF, in the memory of the process that signs | no, never                                      |

Two consequences:

1. **Two providers means two keys, therefore two addresses, therefore two balances**, even if they
   were somehow given the same credential. Nothing about hosts changes this. "One account" in the
   sense of one balance is a smart-account question, and §7 says why it is not answered here.
2. **Mera's derived key is bytes in the signing process.** In a native app that process is the
   app's sandbox. In a web page it is the page — shared with every third-party script, extension
   and injection the page can suffer. That is `apps/web/AGENTS.md:75`: no signer in `apps/web`
   holds a private key. Mera works in Safari on a Mac; the rule is a judgement about where a key
   that moves money may live, not a claim that it cannot run there.

So on the web the marketplace takes an injected EOA — the key stays in the extension, outside the
page — and on the phone it takes Mera, whose key stays in the app. Both produce the same
EIP-191 signature and hit the same `/v1/auth/wallet/verify`; the server does not know or care
which. `identity.wallet_links.kind` already distinguishes them (`external` / `mera`) for the one
place it matters, which is telling a person which of their wallets is which.

And Turnkey is for agents. A person never signs into the marketplace with a Turnkey passkey, and
never will under this design. That sentence is what §3 depends on.

---

## 3. The relying party, decided again

`user-profiles-and-products-v1.md` §7 chose `TURNKEY_RPID=pickler.fun` — the apex — "so the door
stays open": so that a passkey could one day authorize something on the marketplace. §2 closes
that door on purpose, and once it is closed the apex is the wrong answer.

**`TURNKEY_RPID=studio.pickler.fun`.**

What that buys:

- **Every subdomain of `pickler.fun` stops being inside custody's reach.** §7's stated consequence
  — that a documentation or marketing subdomain served by a third party becomes attack surface on
  custody — goes away. `pickler.fun` and `app.pickler.fun` can be served by anything. Only
  `studio.pickler.fun` is production custody infrastructure.
- **Mera's passkey and Turnkey's passkey can never appear in the same picker.** Mera enrols
  against `app.pickler.fun` (§4); Turnkey against `studio.pickler.fun`. A person with both has
  two credentials the browser will never offer side by side, because no origin is inside both
  scopes.
- Nothing is lost that §2 did not already give up.

What it costs: the studio can never move host without re-enrolling everyone. That is the one-way
door §7 described, pointed the other way. The name was chosen with that in mind: `studio` is what
the code has called this product since the split (`STUDIO_SEGMENTS`, `studioHref`,
`NEXT_PUBLIC_STUDIO_HOST`), so the host says what the product is and nothing has to be renamed to
match it. `dashboard` was considered and rejected — a dashboard is where you look at numbers, which
is the marketplace's job, not the studio's. It is the right trade, because "the studio changes
hostname" is a decision somebody makes on purpose, and "a subdomain was delegated to a vendor" is
one that happens by accident.

**This is still a one-way door and nobody is enrolled yet.** It must be set before the first
registration on any deployed environment. `workers/api/.dev.vars.example` and the deployment guide
change in the same commit as this specification.

---

## 4. The phone

The mobile app is native and talks to the API. A host matters to it in exactly three places, and
all three point at `app.pickler.fun`:

- **The relying party for Mera's passkey.** Mera registers and asserts against `app.pickler.fun`.
  The iOS app must be associated with that host: the `apple-app-site-association` file's
  `webcredentials.apps` entry, served at `https://app.pickler.fun/.well-known/apple-app-site-association`.
- **Universal links.** `app.pickler.fun/agents/<handle>` opens the agent in the app when it is
  installed. The same file's `applinks` section. This is new; the file today carries only
  `webcredentials`.
- **The SIWE domain.** The message the phone signs names `app.pickler.fun`, the same value the web
  marketplace uses. One `SIWE_DOMAIN`, not two.

### The four values the app carries, and why each one is `app.pickler.fun`

The React Native app exists and has not shipped. It was built while the marketplace lived on the
apex, so it is likely to carry `pickler.fun` in four places. Each must read `app.pickler.fun`
before the first build that reaches a person, and — because nobody has enrolled a Mera passkey and
nobody has signed in from the phone — changing them costs nothing today and a re-enrolment
tomorrow.

| Where in the app                                       | Must be                          | If left on the apex                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Associated Domains, `webcredentials:` entitlement  | `webcredentials:app.pickler.fun` | **This is the one that breaks §3.** Mera's relying party would be the apex, and a passkey's scope reaches downward, so that passkey is offered on `studio.pickler.fun` — in Turnkey's picker. |
| iOS Associated Domains, `applinks:` entitlement        | `applinks:app.pickler.fun`       | `pickler.fun/agents/x` opens the landing in Safari instead of the app. Paths are unchanged.                                                                                                   |
| Mera's `rpId` (or equivalent) in the SDK configuration | `app.pickler.fun`                | Same failure as the entitlement; the two must agree or WebAuthn refuses the ceremony.                                                                                                         |
| The `domain` the SIWE message builder writes           | `app.pickler.fun`                | The API's `SIWE_DOMAIN` will not match, and every signature from the phone is refused as a replay — which reads as an attack, not as a configuration.                                         |

The API base URL is a fifth host reference and does **not** change: the API is its own worker. Only
if the app was pointed at `pickler.fun/api/v1` does it need to become `app.pickler.fun/api/v1`.

Android is the same four values in `assetlinks.json` and the app's manifest when it comes; nothing
here is iOS-specific except the file name.

The alternative — leave Mera on the apex and put Turnkey back there too — was considered and
refused: it recreates the shared picker this specification exists to prevent, and it does so
permanently, because both relying parties would then be one-way doors pointing at the same place.

The AASA file is in `apps/web/public/.well-known/` and so is served on every host. It should not
be. Served on `studio.pickler.fun`, `webcredentials` would associate the app with the studio's
relying party — the Turnkey passkeys — which is precisely the association §3 exists to prevent. The
middleware answers 404 for `/.well-known/apple-app-site-association` on any host but the
marketplace. The landing has no app; the studio must not have this one.

---

## 5. Sessions, and what "one account" means here

A Supabase session cookie is scoped to the host that set it. That is already the case and it stays
that way: **signing into the marketplace does not sign you into the studio, and vice versa.** The
marketplace's session is minted by the wallet verify route; the studio's by email. They are
different ceremonies on different hosts and they should feel like it.

"One account" means one `auth.users` row, one `identity.profiles` row, one handle — not one cookie.
A person who signs into the studio with their email and into the marketplace with their wallet is
one person when the wallet is linked to that user, which is what `identity.wallet_links` records
and what `POST /v1/auth/wallet/link` already does. What is missing is a screen: the marketplace's
account sheet gets a "wallets" section that lists the links (`GET /v1/auth/wallet/links`) and
offers the link ceremony, which is the sign-in ceremony with a session already present. That is the
one piece of product work in this specification beyond routing.

The studio does not need a wallets section. An agent's wallet is a Turnkey sub-org, and the
person's own wallets are the marketplace's concern.

---

## 6. What changes in the code

Small, because the hard part — a pure host decision — was built already.

**`apps/web/src/server/hosts.ts`.** `ProductHosts` gains `landing`; `Product` gains `"landing"`.
`productFor` compares against three names. `PRODUCT_HOSTS` reads `NEXT_PUBLIC_LANDING_HOST`,
`NEXT_PUBLIC_MARKETPLACE_HOST`, `NEXT_PUBLIC_STUDIO_HOST` with fallbacks `pickler.fun`,
`app.pickler.fun`, `studio.pickler.fun`. `STUDIO_SEGMENTS` is unchanged. A `LANDING_SEGMENTS`
set holds what the landing owns — `/` and whatever static sections exist — and `ownerOf` returns
`"landing"` for those, `"studio"` for the studio's, `"marketplace"` otherwise.

**`apps/web/src/middleware.ts`.** `decide` learns the third product with the same rules: a path
whose owner is another product answers 404 on this host; `/` on the marketplace rewrites to
`/agents`; `/` on the studio rewrites to `/studio` as today; the AASA file answers only on the
marketplace host (§4). `localhost` and any unconfigured host stay `"either"` and serve everything,
so development and the design harness are untouched.

**Cross-product links.** `studioHref` exists. It becomes one `hrefFor(product, path)` over the
three hosts, and the links that point at the landing or the marketplace from the studio (the logo,
"see the marketplace", the sign-out destination) use it. Grep for hard-coded hosts after.

**`scripts/design/routes.mjs`.** The landing route's `product` becomes `"landing"`; `render.mjs`
already picks a base URL by product and is a no-op in development.

**AASA.** `apps/web/public/.well-known/apple-app-site-association` gains `applinks` for
`app.pickler.fun` paths. The middleware gates it by host.

**The marketplace account sheet.** A wallets section, per §5.

**Configuration.** `SIWE_DOMAIN=app.pickler.fun`. `ALLOWED_ORIGINS` lists three origins.
`TURNKEY_RPID=studio.pickler.fun`. Supabase's allowed redirect URL is
`https://studio.pickler.fun/auth/callback` alone — the marketplace has no email sign-in and
the landing has no sign-in. All three hostnames point at the web worker.

**Documentation.** `user-profiles-and-products-v1.md` §7, §9 and the affected §14 entries get a
one-line pointer to this document. `apps/web/AGENTS.md` describes three hosts. The deployment
guide gets the new values.

### What does not change

The API. The database. The SIWE ceremony, the nonce table, the synthetic email domain
(`wallet.pickler.fun` still must never accept mail). The studio's routes and guard. The design
harness's checks. The marketplace's paths.

---

## 7. What this does not do

**Perpl.** An agent trades on Perpl with an Ed25519 API key enrolled once by an EIP-712 signature
from its Turnkey wallet, after `createAccount` and `allowOrderForwarding(true)` on the Exchange
contract. That is real custody work — the trade-scoped key moves collateral inside Perpl and lives
on Pickler's server — and it is the unstarted wave 8 of the Relayer extraction. It gets its own
specification. Two facts from reading Perpl's API documentation belong here so they are not lost:
Perpl's enrolment takes a **secp256k1 wallet signature** and its documentation says nothing of
ERC-1271, so **an EOA is what works** — MetaMask, Mera, Turnkey all qualify; a smart account
probably does not. And Perpl's testnet is chain `10143`, which is `TARGET_CHAIN` already.

**One balance across the person's wallet and the agent's.** Two keys are two addresses (§2). The
usual answer — a smart account with both as owners — runs into the Perpl fact above: the account
Perpl trades from must be an EOA. The candidate that fits is Perpl's own delegation, where the
person's EOA owns the exchange account and the agent operates it through an enrolled key. That is
a question for the Perpl specification, not this one.

**Mera on the web.** §2.

**WalletConnect, and ERC-1271 in the verify route.** Both would widen who can sign into the
marketplace from the web. Neither is needed for the split and each is a day's work when wanted.

**Solana.** `wallet_links` is ready for `siws`; nothing else is.

---

## 8. One-way doors, listed

- `TURNKEY_RPID=studio.pickler.fun` — before the first enrolment on any deployed environment.
- `wallet.pickler.fun` never accepts mail.
- The AASA `webcredentials` association points the app at `app.pickler.fun`; once people have
  enrolled Mera passkeys against it, moving the marketplace host orphans them the same way.

---

## 9. Testing

- `productFor` and `decide` are pure; the existing tests gain the third host and the AASA rule:
  the file answers on the marketplace host and 404s on the other two, and `localhost` still serves
  it.
- The AASA file itself is validated by a test that parses it and asserts `webcredentials.apps` and
  `applinks.details[].appIDs` name the same app identifier.
- `hrefFor` is pure and tested for all three products.
- The design harness runs unchanged; every route keeps its selectors.
- The wallets section is measured like every other screen: a route in `routes.mjs` with a
  `proves` selector on the links list, and an empty state for a person with one wallet.

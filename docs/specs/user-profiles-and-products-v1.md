# User profiles, and the line between the two products

Pickler is two products sharing one identity. This specification draws the line between them, says
what an account is, and connects three pieces that already exist in this repository but have never
met: Supabase identity, the profile and handle feature, and Turnkey custody.

The work it describes is mostly wiring. Almost nothing here is a new subsystem.

---

## 1. The two products

**The marketplace** — `pickler.fun`. Public, light surface. Agents, tokens, perpetual markets, paid
reads, the leaderboard, and a person's own portfolio and activity. You arrive with a wallet, or with
nothing, and you can read everything without signing anything.

**The studio** — `app.pickler.fun`. Dark surface, night blue. Where a person builds an agent, funds
it, sets its limits and watches it run. Also the account screen and every authentication flow.

They are one Next.js application on one Cloudflare Worker, split by `Host` in a middleware that does
not exist yet. Not two deployments: the `/api/v1/[...path]` proxy has to answer on both hosts, and
one application gives that for free. Two deployments would mean two proxies, two sets of
environment variables and two chances to configure them differently.

### Which routes live where

| Marketplace — `pickler.fun`                                      | Studio — `app.pickler.fun` |
| ---------------------------------------------------------------- | -------------------------- |
| `/` the landing                                                  | `/` the studio (`/studio`) |
| `/agents`, `/agents/[handle]`, `/agents/[handle]/ask`            | `/account`                 |
| `/tokens`, `/tokens/[ticker]`, `/tokens/[ticker]/picks/[pickId]` | `/signin`, `/signup`       |
| `/markets`, `/markets/[symbol]`                                  | `/auth/callback`           |
| `/reads`, `/reads/[id]`                                          | `/apply`                   |
| `/leaderboard`, `/analytics` (redirects)                         |                            |
| `/portfolio`, `/activity`                                        |                            |

`/portfolio` and `/activity` are on the marketplace because they need a connected wallet and the
wallet lives on that side. They are about what you hold and what you spent, not about what you built.

`/apply` moves to the studio. It is an application for **studio access** — it always was — and the
page being public does not make it part of the marketplace. It stays a growth flow on the email
side: no Supabase user, no session, a `pk_apply` cookie and a row in `growth.applicants`. Nothing
about it changes except which host serves it.

---

## 2. What an account is

**One Supabase Auth user per person, reached by several credentials.**

This is already the shape of the repository, and it is worth noting because it means the decision
has effectively been made and only the wiring is missing. Every table that matters hangs off the
Supabase user id:

```
profiles        → userId   (auth.users.id)
wallets.turnkey_orgs  → user_id
wallets.wallets       → user_id
wallets.passkeys      → user_id     ← already one user, many credentials
```

`wallets.passkeys` is indexed by `user_id` rather than by credential, so a person may already hold
several passkeys against one account. Linked wallet addresses are the same table shape again, for a
different kind of credential. Nothing new is being invented.

### The credentials

| Credential             | Where       | What it proves           | What it can sign              |
| ---------------------- | ----------- | ------------------------ | ----------------------------- |
| OAuth / six-digit code | studio      | an email address         | nothing on chain              |
| Wallet (Mera, EOA)     | marketplace | control of an address    | its own transactions, present |
| Passkey → Turnkey      | studio      | root quorum of a sub-org | agent activity, unattended    |

Any of them authenticates into the same account. A person who trades first and builds an agent
later does not open a second Pickler; the Turnkey sub-organization attaches to the `user_id` they
already had.

### Why this is the answer to "no quiero cuentas múltiples"

Polymarket is the worked example of the alternative. Signing up by email produces a Magic proxy;
connecting MetaMask through their interface produces a Gnosis Safe; using the API from your own key
is a third thing. They are three accounts with three balances and no path between them, and the
seam shows in their own issue tracker, where API keys register against the signing EOA rather than
the wallet holding the funds and orders are rejected with `signer != api_key`.

The fix is not a better proxy. It is having an identity that is not a wallet.

---

## 3. Signing in with a wallet

Connecting a wallet creates a Supabase session. This is the only genuinely new authentication
surface in this specification.

The shape is Sign-In With Ethereum: the browser asks the API for a nonce, the person signs a message
containing it, the API verifies the signature against the claimed address and mints a Supabase
session for the user that address belongs to — creating that user on first sight.

**The nonce is single-use, domain-bound and short-lived**, and it is stored and consumed exactly the
way `wallets.webauthn_challenges` already is: a row with a five-minute expiry, consumed with
`DELETE … RETURNING` so that two concurrent attempts cannot both succeed. Workers has no Redis, and
this is the pattern the custody work already settled on. Do not invent a second one.

The message must name the domain it was signed for. A signature harvested on one site and replayed
on another is the failure this prevents, and it costs one field.

### A Supabase user with no email

Supabase Auth wants an email or a phone number, and a wallet has neither. The user is therefore
created through the admin API with a **synthetic, non-deliverable address** derived from the wallet
— `<namespace>-<digest>@wallet.pickler.fun` — marked confirmed, with no password. The session is
minted server-side; the service key never reaches the browser.

The local part is a digest of the namespace and address rather than the address itself. The auth
email travels in every access token's `email` claim, so it reaches the browser on every request and
lands in any log or screen that reads a user's email; spelling the address into it would make all
of those a disclosure of which wallet an account belongs to. The namespace stays visible so an
operator can tell the chain families apart, and is hashed in as well so one address on two families
remains two accounts.

The synthetic address is an internal key and never a contact. It is not shown on any screen, it is
never sent to, and **the real email collected before a paid read is a separate field on the
profile**, not a change to the auth identity. Conflating them would mean that a person who links a
second wallet appears to change their email address, and that adding an email would mean rewriting
the identity every downstream row points at.

`wallet.pickler.fun` must therefore never be made to accept mail, and this is one of the reasons §7
says subdomains are production infrastructure.

### Linking a second wallet

A person who connects Mera on their phone and MetaMask on their laptop is one person with two
addresses. **The table for this already exists and has never been used.** `identity.wallet_links`
is declared in `packages/infrastructure/src/persistence/product/identity.ts`, is in the migrations,
and no source file in the repository reads or writes it:

```
wallet_links(id, user_id, namespace, verified_chain, address, method, kind, verified_at)
  unique (namespace, address)
  index  (user_id)
  namespace in ('eip155', 'solana')          method in ('siwe', 'siws')
  kind      in ('external', 'mera')
  address format checked per namespace
  foreign key user_id → auth.users(id) on delete cascade
```

It is better than what this specification would have invented. The unique key is
`(namespace, address)` rather than `address` alone, so the same string on two chain families is two
links rather than a collision. `verified_chain` is CAIP-2 with a check that its family matches the
namespace. `method` already distinguishes `siwe` from Solana's `siws`, and **`kind` already carries
`'mera'`** — somebody designed this table for exactly this work.

Use it. Do not add a second table beside it.

The unique index is what makes "this address is already linked to another account" a database
answer rather than a race. When someone signs in with an address that is already linked, they get
that account — which is the whole point.

Linking while signed in is the same ceremony as signing in, with the session already present. There
is no separate flow to design.

---

## 4. Profiles and handles

`packages/core/src/features/profiles/` already holds this and it is unchanged by this
specification. A profile is `{ userId, displayName, handle, createdAt }`, the handle is lower-case
`[a-z0-9_]{3,15}`, creation is atomic across the two unique constraints, and `RESERVED_HANDLES`
blocks the names that would impersonate the product or its staff. `/v1/handles/:handle/availability`
and `/v1/profile` are mounted.

What changes is **when a person is asked for one**. Today nothing in the marketplace asks. After
this work, claiming a handle is part of connecting a wallet — not a blocking step, but the natural
next one, because a trader with a handle is a participant and a trader without one is an address.

A profile is what makes someone visible on the leaderboard as a person rather than as the owner of
an agent, and it is what a paid read can be attributed to in public.

---

## 5. Where the money is, and who signs

The split that matters is not mobile against web, nor marketplace against studio. It is **whether a
human is present when something is signed.**

**Present.** Trading, depositing, backing an agent, buying a read. The person signs, on their
device, at that moment. Their wallet is their own and Pickler custodies nothing. Mera or an EOA.

**Absent.** An agent that runs every six hours, decides, and signs. No device, no biometric, nobody
awake. This is Turnkey: a key in a secure enclave under a policy, with the person's passkey as the
sub-organization's root quorum.

### Why Mera cannot do the second one

Monad's own comparison of embedded wallet providers describes Mera as a "passkey-derived key
(WebAuthn PRF); non-custodial, no server storage", and lists it as not supporting server-side
signing, delegated or session keys for backend use, spend policies, or agent signing without user
presence. Turnkey is listed with all four.

The reason is structural rather than a missing feature, and it is worth stating because it will come
up again. **Mera derives the key from the passkey; Turnkey uses the passkey to authorize a key that
lives elsewhere.** If the key is derived from the passkey then no passkey present means no key,
which means no signature — ever, by construction. That is also exactly why Mera's claim that no
third party sits in its signing path is true.

Mera's signing sessions do not change this. They remove the biometric prompt from every click while
**you** are trading; they are not a delegation to a server.

Mera does allow exporting the seed phrase, so an agent could be made to work by holding that seed on
Pickler's servers. That is refused here. It would put a raw seed in the product with no quorum, no
policy engine, no per-activity audit trail and none of the two-of-two spend caps specification two
is built around — worse than Turnkey on every axis. Worse than technical, it would silently make
custodial a wallet the person chose because it was not.

### Where Mera is better than Turnkey

In the marketplace, clearly. No seed phrase, so onboarding someone who has never held a wallet is
one biometric rather than twelve words. The same passkey reaches the same account on web and on
native iOS and Android, so a person who starts on their phone does not start again on a laptop. And
signing sessions give order-book trading without a prompt per order — the experience Polymarket
needed a proxy contract, a separate funder address and three account types to approximate.

Each tool is specified where it wins. That the same arrangement satisfies a hackathon bounty is a
happy coincidence rather than the reason.

---

## 6. The master wallet, and when a passkey is created

The account canvas draws _MASTER WALLET_ above _AGENT WALLETS_. Under this specification the master
wallet is **the pot that funds agents**, not the person's trading wallet. It is topped up by sending
to its address, which is why the screen already has a Receive button; Pickler never needs to know
which wallet the funds came from.

**The Turnkey sub-organization is created when a person builds their first agent**, not at signup.
Until then there is no master wallet and `/account` says so, in the same voice as the six panels
that already say what is not built.

The ceremony itself does not change. `issueChallenge`, `register`, `prepareAddPasskey`,
`confirmAddPasskey`, the five tables and their tests are all as shipped. What moves is the point in
the product where `register` is called. A person arriving at the studio already has a Supabase
session — from OAuth, from a six-digit code, or from a wallet they connected in the marketplace —
and the passkey is what turns that session into custody.

---

## 7. The relying party, and one consequence

> **Superseded by `product-hosts-v1.md` §3.** The relying party is `studio.pickler.fun`, not the
> apex, because the door this section kept open — a passkey authorising something on the
> marketplace — was closed on purpose. The consequence below no longer applies. Kept for the record.

`TURNKEY_RPID=pickler.fun` — the apex, not `app.pickler.fun`.

A passkey is scoped to its relying party and the scope reaches downward only: a passkey registered
against `pickler.fun` works on `app.pickler.fun` and on every other subdomain, while one registered
against `app.pickler.fun` works nowhere else. The choice cannot be revised later, because changing
the relying party orphans every credential already enrolled and every person has to enrol again.

The apex is chosen so the door stays open — so that a passkey can one day authorize something on
the marketplace, or the studio can move host, without re-enrolling anyone.

**The consequence, stated so that nobody meets it by surprise: every subdomain of `pickler.fun` is
inside the reach of those passkeys.** A documentation or marketing subdomain served by a third
party becomes attack surface on custody. Subdomains must not be delegated casually, and any that is
must be treated as production infrastructure.

This restates §10 of `turnkey-passkey-custody-v1.md` with the value now chosen.

---

## 8. What the marketplace stores, and what it reads

**On-chain state is read from the address. State Pickler holds needs an account.**

Positions in perpetuals and tokens someone has backed are on chain: they are read from the connected
address and need no account at all. A paid read is different. It is Pickler's own product with a
lifecycle the buyer is not present for — the portfolio screen shows `IN WINDOW · 21H`,
`SETTLED · HAPPENED`, `EXPIRED · REFUNDED` and a count awaiting evaluation. Two clocks: delivery,
then the market.

Someone buys a read and comes back a day later to learn what happened. **An address cannot be
told.** A refund the buyer never hears about is a bad product, and that — not architecture — is why
a read is attributed to a `user_id`.

**Paid reads have no persistence at all today.** There is no reads table in any schema; they are
sample content served by `createSampleAgentDirectory` through `/v1/demo/reads`. So this
specification cannot attach anything to anything — there is no record to carry a `user_id`.

What it does instead is fix the rule, so that whoever builds paid reads is not free to key them by
address: **a paid read belongs to a `user_id`, and the email that hears about its outcome is a
field on the profile.** Keying a read by address would make the refund unannounceable and would
split a person's history the moment they link a second wallet. That work is out of scope here and
is named as such in §13.

### Progressive, not a gate

| Moment               | What happens                    | What is asked for |
| -------------------- | ------------------------------- | ----------------- |
| Browsing             | nothing                         | nothing           |
| Connect a wallet     | account created, address linked | nothing           |
| Trade, back an agent | read from chain                 | nothing           |
| Claim a handle       | profile created                 | a handle          |
| **Buy a paid read**  | Pickler now owes an outcome     | an email _(§13)_  |
| Build an agent       | passkey → Turnkey sub-org       | the ceremony      |

The account appears when it earns its place rather than at the door. Because it exists from the
first connection even while empty, nothing ever has to be migrated later.

---

## 9. Splitting by host

> **Extended by `product-hosts-v1.md`.** Three hosts, not two: the marketplace moves to
> `app.pickler.fun`, the studio to `studio.pickler.fun`, and the apex becomes a landing with no
> authentication. The mechanism below is unchanged; the hostnames and the AASA rule are there.

A `middleware.ts` at `apps/web/src/` reads the `Host` header and decides what that host may serve.

- On `app.pickler.fun`, `/` rewrites to the studio, and marketplace paths answer 404.
- On `pickler.fun`, studio paths answer 404, except that `/studio` and `/account` **redirect** to
  the same path on `app.pickler.fun` so that old links and bookmarks survive.
- `/api/v1/*` answers on both, unchanged.
- In development the middleware is inert: `localhost` matches neither product, every route answers
  as it does today, and nothing is rewritten or refused. Requiring two hostnames locally would make
  the design checks and every contributor's setup worse for no benefit.

The host mapping is a pure function from a hostname to one of three answers — marketplace, studio,
or neither — so both products can be tested without a browser and without the environment the test
happens to run in deciding the result. `previewAllowed` and `sectionFromSearch` are the shape to
copy; each was written that way after a gate tested in only one position turned out to be a gate
tested once.

A 404 rather than a redirect for the wrong-host case is deliberate: a marketplace path answering on
the studio host would split every screen's canonical URL in two, which is worse for search and
worse for anyone reading a link.

### What else has to know about two hosts

`ALLOWED_ORIGINS` on the API must list both. `scripts/design/routes.mjs` measures one base URL and
will need each route to carry its host. Supabase's allowed redirect URLs must include both callback
origins.

Each route now carries a `product`, and `render.mjs` picks a base URL from it — a no-op in
development, where both products answer on one origin. §14 is the full list of what has to be set
outside the code before any of this works in a deployment.

---

## 10. Data model

**One new table.** `identity.wallet_links` already exists (§3) and needs no change. What is missing
is somewhere to keep a nonce between issuing it and verifying the signature:

```sql
identity.siwe_nonces(
  nonce       text primary key,
  expires_at  timestamptz not null
)
  index on (expires_at)
```

It lives in `identity` rather than `wallets` because `wallets` is Turnkey custody, and an address
someone proved they control is not a wallet Pickler holds. Putting it there would suggest custody
that does not exist.

`siwe_nonces` mirrors `wallets.webauthn_challenges` in shape, lifetime and consumption: single-use,
five minutes, taken with `DELETE … RETURNING`. It carries no address, because the nonce is issued
before anyone knows which wallet will answer, and binding it to an address the client claims would
be binding it to something unverified.

`identity` is already in the `schemaFilter` allowlist in
`packages/infrastructure/drizzle.config.ts`, so no configuration change is needed — worth stating
because the custody work nearly shipped an empty migration by forgetting the equivalent.

Unchanged: `profiles`, `handles`, and every custody table.

---

## 11. Errors, and the cases worth naming

**An address already linked to another account.** The unique index answers this. The person is told
the address is in use and is not silently signed into someone else's account, and not silently given
a second one either.

**A signature for the wrong domain.** Refused. The message names its domain and the verifier checks
it rather than trusting the client.

**A nonce used twice.** The second attempt finds no row. `DELETE … RETURNING` makes this
indistinguishable from an expired nonce, which is correct: both mean "ask for a new one".

**Someone reaches the studio with no passkey.** Not an error. There is no sub-organization and no
master wallet, and `/account` says so plainly rather than rendering an empty wallet, which would be
indistinguishable from a wallet with nothing in it.

**A failed read of the linked addresses.** Must propagate rather than degrade to an empty list, for
the same reason the passkey count does: "this account has no wallets" and "we could not look" are
different facts and only one of them is safe to render.

---

## 12. Testing

The wallet sign-in is the only part carrying real risk, and it carries the ordinary ones: replay,
domain confusion, and the race between two concurrent sign-ins on one nonce. Each gets a test that
is proved to fail before it is believed — the same discipline the custody work used, where a race
test was found passing with the race handling deleted.

The host split is a pure function and is tested in both positions, not only in the one the test
environment happens to run in.

---

## 13. Out of scope

Mera's own integration surface is unknown: there is no published wagmi connector and no ecosystem
documentation, because the library is new. **The first task of implementation is a spike** — connect
Mera and sign one transaction — before any screen is built on top of it. If it turns out to need a
deep integration, that is worth knowing early rather than halfway through.

**Paid reads themselves.** There is no reads persistence in this repository — no table, no buyer,
no lifecycle — so neither the purchase, the delivery window, the refund nor the email that
announces the outcome can be built here. §8 fixes the rule those will have to follow and stops
there.

Agent sub-wallets, spend caps and the two-of-two policies remain specification two of the custody
work. Merging two accounts that already exist is not designed, because under this specification two
accounts for one person is not a state the product can reach.

### What Mera turned out to need

The spike this section asked for is done, and the answer is narrower than the paragraph opening it
feared. Mera is open source and readable, so the three answers below come from its source and
reference documentation rather than from a summary of either: repository `category-labs/mera` at
commit `a3102f4` (2026-08-31), published as `@category-labs/mera@0.2.0`.

**1. It does not expose an EIP-1193 provider. It is an SDK.**

There is no provider object, no `window.ethereum` injection, no EIP-6963 announcement and no wagmi
connector in the library. Searching the entire repository for `1193`, `window.ethereum`, `wagmi`,
`eth_requestAccounts` and `eip6963` returns nothing at all. The package declares three entry points
— the root, `/viem` and `/react-native-webauthn-client` — and none of them is a provider; the public
API is a set of functions (`createPasskeyWithPrfOutput`, `getPasskeyPrfOutput`,
`createSecp256k1SigningSession`, `getEvmAddress`, the secret-vault calls) that the application calls
itself.

What it offers instead is one adapter, `toViemAccount(session)`, which returns a viem
`LocalAccount<"mera">` — "accepted anywhere viem takes an account". That is the whole integration
surface for EVM signing.

Source: `library/package.json` and `library/src/index.ts` in
[github.com/category-labs/mera](https://github.com/category-labs/mera);
[mera.category.xyz/reference/to-viem-account/](https://mera.category.xyz/reference/to-viem-account/).

**2. Yes. It signs an arbitrary string, and produces exactly the signature §3 already verifies.**

`toViemAccount(...).signMessage({ message })` "resolves to the EIP-191 personal-message signature
for `message`, 65 bytes as hex" — which is what `personal_sign` produces. The implementation is
`serializeSignature(await signHash(hashMessage(message)))`: viem's own `hashMessage`, so the string
is prefixed and hashed the standard way and signed unchanged, with no wrapping of its own. The
library's test suite asserts the round trip — `recoverMessageAddress({ message, signature })`
returns the account's address.

The address is an ordinary EOA: keccak-256 of the uncompressed public key, last twenty bytes, EIP-55
checksummed. **So verification server-side is plain `ecrecover` and nothing else** — there is no
smart account and no ERC-1271 path to add. This is the answer the sign-in ceremony depended on, and
it is the good one.

One detail worth carrying into the UI rather than discovering later: signing through a session shows
**no** passkey prompt, because the session holds the key in memory. The biometric happens once,
earlier, when the PRF output is fetched.

Source: `library/src/viem.ts` and `library/test/viem-account.test.ts`;
[mera.category.xyz/reference/to-viem-account/](https://mera.category.xyz/reference/to-viem-account/).

**3. Yes, it works in a desktop browser — but only where the authenticator delivers WebAuthn PRF,
and the gaps are real.**

Mera's own compatibility table records a confirmed live PRF cycle for iCloud Keychain on macOS 15+
under Safari, Chrome and Firefox 139+; Google Password Manager on desktop Chrome 132+; Windows
Password Manager on Windows 11 25H2+ under Edge, Chrome 147+ and Firefox 148+; YubiKey 5C Nano; and
Proton Pass. Native iOS 18+ and Android 9+ are supported too, so the cross-device claim in §5 holds.

The exceptions matter more than the list. Marked **not supported** as of 2026-06-01: passkeys held
in the local Chrome profile, Bitwarden on desktop Chrome, and Dashlane on desktop Chrome. The
documentation is blunt about why: "On desktop Chrome, only passkeys saved to Google Password Manager
carry PRF. The local profile authenticator lacks `hmac-secret`, the CTAP primitive behind PRF."
Worse, Chrome may put the passkey there without being asked — when "Offer to save passwords and
passkeys" is off, or when a third-party password-manager extension intercepts WebAuthn — and then
"the passkey exists but returns no PRF output, so mera cannot use it and
`createPasskeyWithPrfOutput` fails".

That is a person with a working passkey who cannot be onboarded, caused by a browser setting they
have never seen. It is a named error, not a caught exception, and it belongs with the cases in §11.

Source: [mera.category.xyz/authenticator-support/](https://mera.category.xyz/authenticator-support/).

### What this means for the plan

**Nothing is blocked, and no task changes shape.** Every task in the plan was written to work with
any wallet that can sign a string, and Mera signs strings — producing the ordinary EIP-191 signature
over an EOA address that §3's verification already expects. The server side needs no Mera-specific
code whatsoever, and `wallet_links.kind = 'mera'` remains exactly right.

**But the connector task does not simply gain a connector.** Because there is no EIP-1193 provider,
wagmi cannot discover or connect Mera, and no adapter exists to be installed; the two honest options
are to write a custom wagmi connector that synthesises a provider around the viem `LocalAccount`, or
to leave Mera outside wagmi entirely and call the SDK directly for the one signature sign-in needs,
keeping wagmi for EOAs. The second is much smaller and is all the ceremony actually requires, so it
is the one to cost first. **Mera is a second connector, not a precondition** — the marketplace can
ship on EOAs and add it without revisiting anything downstream.

The one genuinely new piece of work this spike found is not the connector at all. It is the
PRF-unavailable case in answer 3, which needs an error and a screen that tells the person what to
change.

### `packages/core` does not typecheck its own tests

Recorded here because it was found during this work and is its own task, not part of it.

`packages/core/tsconfig.json` is `"include": ["src/**/*.ts", "src/**/*.tsx"]`. It does not include
`test/`, and the suite runs under `tsx`, which strips types without checking them. So **nothing
typechecks `packages/core/test/`** — a type-level assertion placed there is never evaluated by any
tool and cannot fail. This was found by writing a `@ts-expect-error` pin in `wallet-auth.test.ts`,
deleting the type it was pinning, and watching the forced typecheck pass in silence. The pin now
lives at the foot of `src/features/identity/domain/wallet-auth.ts`, where tsc does look.

`apps/web` and `packages/infrastructure` do include `test/` and are unaffected. `packages/chain`,
`packages/api-schema`, `packages/agent-runtime`, `packages/ui` and `workers/api` have the same gap
as core.

Turning it on for core is one line and surfaces **56 errors**:

- **41 are `TS2591`** — `node:test`, `node:assert/strict` and `node:crypto` unresolved, because
  `@types/node` is not in scope for that project. One config fix clears all of them.
- **15 are genuine type errors** in existing tests: `paper.test.ts` (6), `applications.test.ts` (2),
  `agents.test.ts` (2 — an `AgentSummary` literal missing `handle` and `venue`, and a directory fake
  whose `getPersona` is optional where the port requires it), and one each in `nfl.test.ts`,
  `market-scope.test.ts`, `discovery.test.ts` and `custody.test.ts`.

Those fifteen are the scope. Doing it inside a feature branch would mean that branch's failures and
this backlog's failures arriving in one test run with no way to tell them apart.

---

## 14. Before this works in a deployment

Everything below lives outside this repository's code. None of it is covered by a test, a
typecheck or a `curl`, which is why it is written down: each one fails in a way that looks like
something else.

**The two hostnames, on the web worker.** `NEXT_PUBLIC_MARKETPLACE_HOST` and
`NEXT_PUBLIC_STUDIO_HOST`. `apps/web/src/middleware.ts` falls back to `pickler.fun` and
`app.pickler.fun`, so a deployment that sets neither still works on those two names and silently
does the wrong thing on any others — a preview deployment, a staging domain, a custom hostname.
The fallback is a convenience for development, not a configuration.

**Set these in the build environment, not only as worker `vars`** — the step that runs
`next build`. `NEXT_PUBLIC_*` is Next's prefix for values inlined into the bundle at compile time,
and the middleware reads both at module scope, so a value supplied only as a runtime binding in
`apps/web/wrangler.jsonc` may never be consulted: the build succeeds, the worker starts, the
fallbacks stay in place, and nothing reports that the setting was ignored. Setting them at build
time is correct whichever way the bundler resolves them, which is why it is the instruction here.

**This one is not yet confirmed against a production build.** Inlining is documented for the
browser bundle; whether the edge bundle keeps a runtime `process.env` read is a property of the
build and was not established. The dev server's output keeps the read — `.next/server/edge`
contains `process.env.NEXT_PUBLIC_MARKETPLACE_HOST ?? "pickler.fun"` literally — but a dev artifact
says nothing about `next build`, and the production build could not be run here for an unrelated
reason. Someone should grep the built edge chunk for the literal before trusting worker `vars`
alone. Until then the build-time setting is the one that is safe either way.

**Both hostnames pointed at the web worker.** `pickler.fun` and `app.pickler.fun` must both route
to it. The middleware decides what a host may serve; it never gets the chance if the host does not
arrive.

**`SIWE_DOMAIN` and `WALLET_EMAIL_DOMAIN`, on the API worker.** Without both, `walletAuthServices`
returns `undefined` and **the wallet routes are not mounted at all** — the rest of the API serves
normally, so the symptom is a 404 on `/v1/auth/wallet/*` and nothing in the logs saying why. This is the
same gate `/v1/signing` sits behind, and it fails the same quiet way.

`SIWE_DOMAIN` must equal the origin's host as the browser sees it. A signature is bound to the
domain in the message it signed, so a value that does not match rejects every signature as though
it were replayed from somewhere else — the failure reads as an attack, not as a typo.

**`ALLOWED_ORIGINS` carrying both.** `https://pickler.fun,https://app.pickler.fun`. A missing
origin fails **only in a browser**: the tests pass, `curl` passes, and the preflight is refused in
front of a user. It is the one item here with no local symptom whatever.

**The API's database role able to read `auth.users`.** `findUserIdByEmail` runs
`SELECT id FROM auth.users WHERE email = $1 LIMIT 1` on the API's own pool, because the Supabase
admin API has no lookup by email. `auth.users` is Supabase's schema rather than ours, so the grant
is not something any migration in this repository makes.

Its absence has the same shape as a missing origin — invisible to every gate — but a worse
signature. It does not fail at boot and it does not fail in any test. It fails at run time, for a
returning person, on the recovery path that only runs when two requests race to create the same
account. So it presents as an intermittent sign-in failure affecting some people some of the time,
which is close to the worst possible way for a permission to be missing.

**Supabase's allowed redirect URLs carrying both callback origins.** `https://pickler.fun/auth/callback`
and `https://app.pickler.fun/auth/callback`. An origin that is not listed does not error at
sign-in; it completes and returns the person to the site root with no session, which reads as "it
just did not work".

**`TURNKEY_RPID`, and it is a one-way door.** _(Value superseded: `studio.pickler.fun`, per `product-hosts-v1.md` §3.)_ A passkey is scoped to its relying party
and the scope reaches downward only: one registered against `pickler.fun` works on
`app.pickler.fun` and every other subdomain, while one registered against `app.pickler.fun` works
nowhere else. Changing the value later does not migrate anything — it **orphans every credential
already enrolled**, and every person has to enrol again. It must therefore be right before the
first registration, not after. §7 has the consequence this buys and the cost it carries.

**`wallet.pickler.fun` must never be made to accept mail.** Every wallet account is given an
opaque key at that domain, because Supabase requires an email and a wallet does not have one. It is
an identifier and it is not deliverable by design; only `identity.wallet_links` can resolve one
back to a wallet. Pointing MX records at that subdomain turns every one of those identifiers into a
live mailbox — which makes an internal key into an address that can receive a password reset.
Nothing in the code can detect that this has happened, and the rule holds whatever shape the key
itself takes.

---

## Validation

Measured on 2026-09-23 against the rendered application, over 38 commits. Everything below is
output, not intention.

**Gates**, checked by exit status rather than by filtering output — see the note at the end of this
section for why that distinction earned its own place. Typecheck, lint, Prettier and `npm test` all
exit 0; 666 tests with 665 passing, 1 skipped and none failing; `@pickler/web` builds. The five
rendered design checks are clean over all 15 routes, and the harness's own suite is 13 of 13.

### What was built, against what was specified

The host split, the wallet sign-in ceremony end to end, `identity.wallet_links` finally written to
after existing unused since it was declared, profiles reachable from the marketplace, and the
passkey ceremony moved from signup to first-agent creation. Eighteen planned tasks became twenty:
two were added during the work, both because a spike found something the plan had assumed.

### Four defects in the specification, found by building it

**`identity.wallet_links` already existed and nothing had ever used it.** The specification
proposed a `linked_addresses` table; the repository already had a better one, unique on
`(namespace, address)` rather than on the address alone, with `method` distinguishing `siwe` from
`siws` and `kind` already carrying `'mera'`. Someone designed it for exactly this work.

**Paid reads have no persistence at all**, so the claim that reads attach to an account could not
be implemented. §8 now fixes the rule for whoever builds them rather than describing a change to a
table that does not exist.

**`apps/web/src` cannot import `@pickler/core`,** by a lint rule that exists to keep the web app
talking to the API over HTTP rather than to the domain. The handle rules are mirrored into
`@pickler/api-schema` in the idiom `applications.ts` and `markets.ts` already use, held to core by
a test in `workers/api`, which is the only package that can see both.

**And §3 described the synthetic address in its pre-digest spelling** after the digest landed — a
sentence that had quietly become false in the section that exists to explain what that address is.

### Three defects in the design, found by reading the code

**The synthetic auth email travelled further than the design assumed.** It is a claim in every
access token, so it reaches the browser on every request; `GET /v1/auth/me` returned it verbatim;
and — the severe one — `custody.ts` passed it as the WebAuthn `PublicKeyCredentialUserEntity`'s
`name` and `displayName`. Those are what an operating system's passkey picker displays and what the
authenticator stores, synced to iCloud Keychain or Google Password Manager and editable by nobody.
A person who traded first and built an agent later — the journey §2 is built on — would have ended
up with a credential permanently labelled with their wallet address. The passkey now takes its name
from the profile, and the local part of the synthetic address is a digest rather than the address,
which makes the first two harmless as well.

A fourth channel was missed in that pass and closed afterwards: `user_metadata`, written at account
creation, is carried in the access token and exposed on `session.user` — which this repository
already reads in the browser. Two consecutive commits closed two channels and left the third open
twelve lines below one of them. It now carries the namespace and not the address.

**`syntheticEmail` lower-cased the address a second time.** On EVM that is a no-op because
`normalizeAddress` already had. On Solana it is destructive: base58 is case-significant, so two
distinct addresses collapsed to one synthetic email and therefore **one account shared by two
people** — the exact failure this specification exists to prevent. The digest removes the shape as
well as the instance, because a hex digest has no case to lose.

**An unreadable nonce expiry made the nonce immortal.** `expiresAt <= now` answers false for
`NaN`, so a fail-open on the control that bounds a sign-in's replay window. Written as "not still
valid", `NaN` takes the reject path. It is the same shape as viem answering an unparseable
`Issued At:` with `new Date(NaN)`: a field that is present but invalid survives a presence check,
and so does any comparison, because `NaN` makes every answer false and half of those falses read as
fine.

### What came close

Nothing in the contrast ramp moved, because no new tokens were introduced. The narrowest figures
remain the ones recorded in `design-system-v2.md`: `--pk-ink-faint` on `--pk-panel-3` at 4.61:1 and
`--pk-cyan-ink` on `--pk-panel-3` at 4.54:1.

`ALLOWED_ORIGINS` named `localhost:3000` while this worktree's dev server runs on 3001, so browser
calls from the working dev server were already being refused. Found incidentally; nothing in any
test could see it.

### On verification itself

Six tests specified in the plan turned out not to catch the regression they were named for. The
pattern is one thing: **asserting the description instead of the behaviour.** A rail's phase list
went green while `next()` still routed to the passkey step; `decide()` asserted a structure while
the routing lived in a branch above it; a nonce spent twice in sequence behaves identically under
both orderings, because the window the order closes is concurrent and a sequential test has no
concurrency to observe. Each was found by mutating the thing the task existed to prevent and
checking which test went red.

Two checks could not fail at all. A `@ts-expect-error` pin sat in `packages/core/test/`, which that
package's `tsconfig.json` does not include, so nothing ever typechecked it; it now lives in `src`
as a conditional type. And a `trim()` mutation was invisible because the fixture had no whitespace
at its edges.

**And a green can come from a command that never ran.** `tsc | grep -c "error TS"` returning `0`
means "no matching lines" and "no output at all" indistinguishably. Both an agent and the lead
reported clean gates from filtered output while those gates were failing. Exit status is the
verification; the filter is a convenience.

### What a person can and cannot reach

**Reachable, end to end.** Connect a wallet, type a handle, press Claim: that signs one line the
server built, verifies it, and puts the tokens into Supabase. The session is cached, so a second
action does not spend a second prompt. Signing in happens on Claim rather than on connect
deliberately — `connect-modal.tsx` promises on screen that connecting is not signing, and firing a
prompt the moment someone connects would make that line false and train people to approve prompts.

Custody is reachable too: `/custody` mounts the rail on the mode Task 16 built, and `/account`
offers it where the screen already says there is no wallet yet. Nothing new was designed; it is the
sign-up ceremony on its own page, entered by someone who chose it.

**Not reachable.** Custody does not start from the studio's first-agent journey. `agent-form.tsx`
has no idea whether a wallet exists, and giving it one means a new `GET /wallets/me` dependency
inside `features/studio` plus the design questions that come with it — what an agent without a
wallet can and cannot do, whether the rail belongs in a sheet or a page. So §6's trigger is
currently "when the person chooses", not yet "when they build their first agent". `custody_started`
is still dispatched by nothing; the page sets its initial step directly.

Linking a second wallet is unbuilt: `POST /v1/auth/wallet/link` has no browser caller. A person with
one wallet has a complete account, which is why this was the one of the three to drop.

**Solana cannot happen.** `namespace` is hardcoded `"eip155"` in both places that could produce
one, and the store writes `method` as the literal `'siwe'`. §3 explains why `(namespace, address)`,
`method in ('siwe','siws')` and `kind in ('external','mera')` make `wallet_links` better than what
this specification would have invented — three of those four capabilities are reachable only by
future work.

**`kind: 'mera'` is never written.** Both link paths hardcode `'external'`. The server cannot tell
which connector signed, and nothing in the request carries it, so this was not implementable as
designed: the client would have to say, and no field exists for it.

**Expired nonces are never deleted.** Rows leave `identity.siwe_nonces` only through `consume`, so
an issued-and-abandoned nonce stays forever. The index on `expires_at` is there for a sweeper that
does not exist.

**And the `(auth)` group has never been measured by the design checks.** Not `/signin`, not
`/signup` — `routes.mjs` carries 15 routes and none of them is in that group. Pointing a route at
`/signup` finds eight violation classes. That is unmeasured ground rather than a regression, and it
retires a claim made in `design-system-v2.md`, corrected there.

### What was left

Paid reads, which have no persistence to attach an account to. `@category-labs/mera` is not yet a
dependency, because no file imports it — the adapters are written and the SDK call site is not.
Merging two accounts that already exist, which this design makes unreachable rather than solvable.
Turning on `test/` typechecking for the five packages that omit it, which surfaces 56 errors of
which 15 are genuine and is its own task.

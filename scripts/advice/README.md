# Local x402 test server

`local-x402-server.ts` is a **local test tool**. It stands in for the product API so the iOS app
on the simulator can pay a Studio agent's advice analysis with x402.

- **Fake:** identity (SIWE sign-in with in-memory bearer tokens and a fixed username), the
  database (payments and jobs live in memory and vanish on restart) and the analysis (a canned
  BTC/ETH answer labelled "LOCAL TEST — not a real analysis").
- **Real:** the payment. The paid request goes through core's `createPaidAdvice` and
  infrastructure's `createAusdAuthorizationGateway`, which settle through the deployed
  `PicklerAdviceSplitter` on Monad testnet. **Each paid analysis moves 1.5 AUSD for real**: 65% to
  the agent wallet and 35% to the treasury, with gas paid by the relayer.

**Never deploy it.** It trusts any wallet that signs in, links that wallet as the payer, has no
persistence and no reconciliation. It listens on `127.0.0.1` only.

## Inputs

`.local-x402/env` at the repository root (git-ignored, mode 600):

```sh
RELAYER_PRIVATE_KEY=0x…   # pays the gas of each settlement; needs testnet MON
RELAYER_ADDRESS=0x…       # checked against the key
AGENT_WALLET=0x…          # the payee: receives the creator share
```

`LOCAL_X402_ENV`, `LOCAL_X402_PORT` (default 8899) and `MONAD_RPC_URL` (default
`https://testnet-rpc.monad.xyz`) override the defaults. The splitter, treasury and AUSD
addresses are constants in the script.

## Run

From the repository root, after `npm ci` and `npm run build:shared`:

```sh
node --import tsx scripts/advice/local-x402-server.ts
```

On start it checks that the RPC is chain 10143 and that `splitter.treasury()` and
`splitter.asset()` match the constants, and refuses to start otherwise. It prints the relayer
address and MON balance, and warns when the balance is zero. Each request is logged with its
method, path and status; a settlement logs its transaction hash and both shares. The key and the
`X-PAYMENT` signature are never logged.

## Point the app at it

From `apps/mobile` (see `apps/mobile/README.md` for the simulator set-up):

```sh
PICKLER_API_URL=http://localhost:8899/v1 \
ADVICE_SPLITTER_ADDRESS=0x570A291Ac86d2F002Bc62E7d12ba43B7F4554d2a \
npx expo run:ios
```

The values are baked in at build time, so rebuild after changing them. The app signs in to the
local server with its wallet, sees one agent ("Local Test Agent", `@localtest`, 1.5 AUSD), and
pays from the wallet's own AUSD. The job goes queued → running → completed in about 10 seconds.

## Endpoints (base `/v1`)

| Method | Path                                       | Shape                                   |
| ------ | ------------------------------------------ | --------------------------------------- |
| POST   | `/auth/wallet/nonce`                       | `{ data: { message, nonce } }`          |
| POST   | `/auth/wallet/verify`                      | `{ data: { userId, session } }`         |
| GET    | `/profile`                                 | `{ data: { handle, … } }`               |
| GET    | `/handles/:handle/availability`            | `{ data: { handle, available } }`       |
| GET    | `/marketplace/agents`                      | bare array of agent summaries           |
| POST   | `/agent-advice/agents/:id/recommendations` | 402 x402 body, or 202 `{ data }`        |
| GET    | `/agent-advice/recommendations/:id`        | `{ data: recommendation }`              |
| GET    | `/agent-advice/agents/:id/recommendations` | `{ data: { items, nextCursor: null } }` |

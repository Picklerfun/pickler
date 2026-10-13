# Local x402 test server

`local-x402-server.ts` is a **local test tool**. It stands in for the product API so the iOS app
on the simulator can pay a Studio agent's advice analysis with x402.

- **Fake:** identity (SIWE sign-in with in-memory bearer tokens and a fixed username) and the
  database (payments and jobs live in memory and vanish on restart).
- **Real:** the analysis. `local-analysis.ts` runs trading's production `createAdviceRunner` over
  public Perpl testnet data (60 closed hourly candles, a 20-level book and the ticker, read with
  agent-runtime's `readPerplInstrument`) and asks the chat model in `.local-x402/model.env` for the
  24-hour BTC/ETH orientation with production's forecast instructions. Unlike production there is
  no JEV sufficiency review, no web sources and no cost accounting. If the data, the model or its
  output fails, the job ends `failed` with `ANALYSIS_FAILED`; there is no canned answer.
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

`.local-x402/model.env` (git-ignored, mode 600), an OpenAI-compatible chat model. Without it, or
with a malformed value, the server refuses to start:

```sh
MODEL_BASE_URL=https://…/v1   # https (http only on localhost); /chat/completions is appended
MODEL_ID=…
MODEL_API_KEY=…
MODEL_RESPONSE_FORMAT=none     # optional: json_object (default) or none
```

`MODEL_RESPONSE_FORMAT=json_object` sends `response_format: { type: "json_object" }`; `none` omits
it, for providers that reject that value (Anthropic's OpenAI-compatible endpoint answers 400). The
prompt asks for JSON either way, and an answer that is not the expected JSON fails the job.

`LOCAL_X402_ENV`, `LOCAL_X402_MODEL_ENV`, `LOCAL_X402_PORT` (default 8899) and `MONAD_RPC_URL` (default
`https://testnet-rpc.monad.xyz`) override the defaults. The splitter, treasury and AUSD
addresses are constants in the script.

## Run

From the repository root, after `npm ci` and `npm run build:shared`:

```sh
node --import tsx scripts/advice/local-x402-server.ts
```

On start it checks that the RPC is chain 10143 and that `splitter.treasury()` and
`splitter.asset()` match the constants, and refuses to start otherwise. It prints the relayer
address and MON balance and the model ID with its base URL host, and warns when the balance is
zero. Each request is logged with its
method, path and status; a settlement logs its transaction hash and both shares. The key and the
`X-PAYMENT` signature are never logged; the model key is neither logged nor echoed in errors.

The analysis tests stub the model and the data, so they run without network:

```sh
node --import tsx --test scripts/advice/local-analysis.test.ts
```

## Point the app at it

From `apps/mobile` (see `apps/mobile/README.md` for the simulator set-up):

```sh
PICKLER_API_URL=http://localhost:8899/v1 \
ADVICE_SPLITTER_ADDRESS=0x570A291Ac86d2F002Bc62E7d12ba43B7F4554d2a \
npx expo run:ios
```

The values are baked in at build time, so rebuild after changing them. The app signs in to the
local server with its wallet, sees one agent ("Pickler Perps Analyst", `@perpsanalyst`, 1.5 AUSD),
and pays from the wallet's own AUSD. The job goes queued → running → completed (or failed) as the
Perpl reads and the model answer, usually within a minute.

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

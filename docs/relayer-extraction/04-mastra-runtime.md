# 04 — Mastra agent runtime and agent SDK

Status: research report. Nothing here is implemented in Pickler yet. Code blocks under "Proposed" are design sketches, not existing code.

## 0. Sources, method, and confidence

| Source                                                | Location                                                  | Commit                                                  |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Relayer monorepo snapshot (`develop`)                 | `relayer-src/` (read-only scratch copy)                   | `bb6bb1226e9289f675e355e7c022530e1e790fd9`              |
| relayer-agent-kit (local, `main`, clean working tree) | `/Users/Juvenal/Development/SherryLabs/relayer-agent-kit` | `9d9c0afec52f5e4a5b2807ba226cbc0a590de465` (2026-06-08) |

In this report, `relayer-src/` means `/private/tmp/claude-501/-Users-Juvenal-Development/83715a79-9eaf-4f2a-aec1-ba792780bc42/scratchpad/relayer-src` and `kit/` means the relayer-agent-kit path above.

Method: static reading of source, manifests, the kit `pnpm-lock.yaml`, and installed `node_modules` in the kit (read only). No packages were installed, no network calls were made, no secret values were read (only variable names in `.env.example`), and nothing was executed against a live API. A small read-only script traced the static import graph of the installed `@mastra/core@1.35.0` `dist/` files.

Confidence labels used below:

- **Verified (code)**: read directly in the cited file.
- **Verified (installed pkg)**: read in the kit's installed `node_modules`.
- **Inferred**: follows from the code, but was not run.
- **Unverified**: comes from outside knowledge of Cloudflare or Mastra and could not be checked offline. Check it with a spike before relying on it.

### Two SDK forks

`@relayerfi/agent-sdk` and `@relayerfi/skills-client` exist in **both** repositories, and the two copies have diverged (`diff -rq`):

| Aspect                             | `relayer-src/packages/agent-sdk` (v0.1.0 in package.json)                                                                    | `kit/packages/agent-sdk` (v1.0.0)                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget response adapter (M7)       | Missing. It reads `budget.infra.exhausted` (`core/budget-guard.ts`)                                                          | Present. It reads `data.categories[].status === "exceeded"` (`core/budget-guard.ts:29-32`)                                                    |
| x402-pay body and response (M1/M2) | Old shape: `{ paymentRequirement, idempotencyKey }` (`core/x402-handler.ts:47`), reads `paymentResult.paymentHeader` (`:54`) | Aligned: `{ resource_url, amount, recipient, chain, idempotencyKey }`, reads `data.x402_headers.payment_response` (`core/x402-handler.ts:61`) |
| Non-custodial V1 (Turnkey 2-of-2)  | Present: `x402-v1-cosign.ts`, `turnkey-stamper.ts`, `turnkey-http-stamper.ts`, `sign-intent.ts`, `signing/*`                 | Absent                                                                                                                                        |
| zod                                | `^3.23.8`                                                                                                                    | `^4.3.6`                                                                                                                                      |
| Dependencies                       | `@turnkey/api-key-stamper@0.6.7`                                                                                             | none besides zod                                                                                                                              |

Neither fork fully matches the API in the snapshot (see §1.4). When porting, start from **the kit fork** for the control-plane pieces and treat the snapshot's V1 files as reference only.

---

## 1. How Mastra agents are structured today

### 1.1 Relayer snapshot: `apps/agent` (BI agent)

This is a single Mastra app that acts as a pure HTTP client of relayer-api (`relayer-src/apps/agent/CLAUDE.md`, `README.md`). Verified (code):

| Concern                      | Implementation                                                                                                                                                       | File                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Mastra instance              | `new Mastra({ agents: {'bi-agent'}, workflows: {'daily-report','hourly-alert'}, storage: LibSQLStore(file:./mastra.db), logger: PinoLogger })`                       | `src/mastra/index.ts:9-24`                                |
| Agent                        | `new Agent({ id:'bi-agent', instructions, model: trackedModel, tools:{ onChainFetcher, analyticsFetcher, alertEmitter, listSkillsTool, executeSkillsTool } })`       | `src/mastra/agents/bi-agent.ts`                           |
| Model                        | `@ai-sdk/anthropic` `claude-haiku-4-5`, wrapped so `doGenerate`/`doStream` emit `llm_call` events                                                                    | `src/mastra/tracked-model.ts`                             |
| Tools                        | `createTool({ id, inputSchema, outputSchema, execute })` with zod. Each calls `sdk.http.get/post` against `/v1/agents/:id/{balance,analytics,notifications,reports}` | `src/mastra/tools/*.ts`                                   |
| Workflows                    | `createWorkflow().then(step).commit()`. Steps call `mastra.getAgent('bi-agent').generate()` and `sdk.http`                                                           | `src/mastra/workflows/daily-report.ts`, `hourly-alert.ts` |
| Tool reuse outside the agent | `alertEmitter.execute!(input, {} as never)`, a type hack                                                                                                             | `src/mastra/workflows/hourly-alert.ts:90`                 |
| SDK singleton                | `new RelayerSDK({ agentId, secret, apiUrl })` from env with `!` assertions. It also exports `relayerMastraHook(sdk)`                                                 | `src/mastra/sdk.ts`                                       |
| Cron                         | `node-cron`: `0 8 * * *` daily report and `0 * * * *` hourly alert (UTC), each running `workflow.createRun().start()`                                                | `src/mastra/cron.ts`                                      |
| Entry                        | `src/index.ts` calls `startCronSchedules()`                                                                                                                          | `src/index.ts`                                            |
| Env                          | `ANTHROPIC_API_KEY`, `RELAYER_API_URL`, `RELAYER_AGENT_ID`, `RELAYER_AGENT_SECRET` (names only)                                                                      | `.env.example`                                            |
| Memory                       | None. No `Memory` is configured, and LibSQL holds only Mastra's workflow and trace tables                                                                            | `src/mastra/index.ts`                                     |
| Tests                        | None (`"test": "echo 'No tests yet'"`)                                                                                                                               | `package.json`                                            |

Versions: `@mastra/core ^1.24.0`, `@mastra/libsql ^1.8.0`, `@mastra/loggers ^1.1.1`, `mastra` CLI `^1.4.1`, `node-cron ^4.2.1`, Node `>=22.13.0` (`apps/agent/package.json`). The snapshot has no lockfile, so the exact resolved core version is **unverified**. `CLAUDE.md` says "Mastra 1.4.1", which is the CLI version, not core.

Deployment in the snapshot is **not reproducible**:

- `docker-compose.yml` points to `apps/bi-agent/Dockerfile`, which does not exist. `CLAUDE.md` admits this.
- `docs/production-deploy.md` is marked "BLOCKED" and references a pm2 `ecosystem.config.cjs` that is not in the snapshot.
- **Inferred:** `mastra build`/`mastra start` bundle from `src/mastra/index.ts`, which never imports `cron.ts`. Under `mastra start`, the crons would never register. The kit's content-agent found exactly this bug in production. See `kit/apps/content-agent/src/mastra/index.ts:93-99`: "Verified 2026-05-28 after discovering the cron had never run in production". The fix there was to call `startCronSchedules()` as a side effect of the Mastra entry module.

### 1.2 relayer-agent-kit: the live pattern (content-agent, "Mastra on VPS")

`kit/docs/architecture.md` makes "Mastra on a long-lived VPS process" the standard runtime. The live example is `kit/apps/content-agent`. Verified (code):

- **Mastra instance:** `PostgresStore({ id, connectionString: env.DATABASE_URL, schemaName: 'mastra', max: 5 })`, one agent (`drafter`), two workflows (`cycle-skeleton`, `messaging-ingest`), and `server.apiRoutes` for webhooks (`src/mastra/index.ts`). `@mastra/core ^1.35.0` is required because `@mastra/pg@1.11.0` peer-requires core `>=1.34.0` (header comment in the same file; confirmed in `kit/pnpm-lock.yaml:1271-1275`).
- **Durable human approval:** a step with `suspend()`, `resumeSchema`, and `suspendSchema` (`src/mastra/workflows/cycle.ts:695-730`). The snapshot lives in Postgres, so a run survives restarts.
- **HTTP:** `registerApiRoute('/webhooks/telegram/:tenantId' | '/webhooks/typefully/:tenantId' | '/healthz')` on Mastra's embedded Hono server (`src/mastra/http.ts:157-472`).
- **Cron:** seven in-process `node-cron` schedules, including a **5-second** inbox poller `*/5 * * * * *` (`src/cron.ts:1255-1297`). Because of this, pm2 must run `instances: 1, exec_mode: 'fork'` (`ecosystem.config.cjs`).
- **Deploy:** Docker with node:22.13-alpine, `mastra build`, and `pm2-runtime` (`Dockerfile`). Neon Postgres uses a NOBYPASSRLS app role on the pooled endpoint (`kit/docs/deploy-vps-checklist.md` §0).
- **Useful domain patterns** (not Relayer-API-bound):
  - Config coerced with defaults: `src/db/agent-config-repo.ts`
  - Atomic check-and-increment spend cap using `SELECT … FOR UPDATE`: `src/db/budget-repo.ts`
  - A pure approval state machine: `src/lib/approval-decision.ts`
  - An audit log: `src/db/audit-log.ts`
- **Important:** content-agent does **not** use `@relayerfi/agent-sdk`. Its header comment says "no budget tracking in MVP" (`src/mastra/index.ts`). The only live Mastra vertical therefore does not exercise the HMAC control plane.

### 1.3 How agents authenticate to and call relayer-api

#### HMAC contract

Verified in both client and server code:

- Client: `relayer-src/packages/agent-sdk/src/core/http-client.ts:30-42`
- Server: `relayer-src/apps/api/src/kits/agent/guards/agent-auth.guard.ts:83,100-125`
- Contract doc with a test vector: `relayer-src/apps/agent/docs/hmac-auth-contract.md`

```
x-agent-id:          <agentId>
x-agent-auth:        hex(HMAC-SHA256(secret, METHOD + path + tsSeconds + hex(SHA256(JSON.stringify(body) or ""))))
x-request-timestamp: <unix seconds>, ±60 s window
X-SDK-Version:       informational
```

The server rejects `status === 'killed'` agents with `401 agent_killed` before checking the signature, and compares signatures with `timingSafeEqual`.

The server hashes a **re-serialized parsed body**, not the raw bytes. Unicode escapes, number formatting, or key order can therefore break signatures.

**Inferred:** the server signs `request.path`, which excludes the query string (`agent-auth.guard.ts:117`). The client signs whatever `path` string it receives. Any SDK GET that includes `?query` would fail auth.

`HttpClient` defaults: 3 retries with exponential backoff and jitter, retrying on 429/5xx/network errors; 30 s timeout through `AbortSignal.timeout`; `node:crypto` HMAC (`http-client.ts:1`).

#### Budget checks

The SDK facade exposes two checks (`relayer-sdk.ts:124-138`):

- `checkBudget()` checks infra and tokens, and fails open when only payments is exhausted.
- `checkPaymentBudget()` first checks kill switch state, then all three layers. It is meant to fail closed.

**Authoritative** enforcement is server-side: an atomic Redis Lua script with `HINCRBY` (`relayer-src/apps/api/src/kits/agent/lua/budget-check.lua`), plus compensating refunds and a monthly reset (`kit/docs/architecture-current.md` §5). Client checks are advisory guards only.

#### Kill switch

`KillSwitch` polls `GET /v1/agents/:id/status` every 30 s using `setInterval(...).unref()` (`kill-switch.ts:25-27`). It is blocked if `isActive || !isApiReachable`.

#### Event batching

`EventBatcher` buffers events, flushes every 10 s or at 50 events, and flushes immediately on `payment` (`event-batcher.ts`). It sends `POST /v1/agents/events/batch` and maps `RelayerEvent → {type, amount?, metadata}`. Failures are handled as follows:

- 429/5xx or network errors: the batch is re-queued, with a 60 s backoff.
- Other 4xx errors: the batch is dropped.

The server accepts any type but maps only `llm_call → tokens` and `x402_call → infra` to budget (`agent.controller.ts:469-500`, `architecture-current.md` §9.3). This endpoint is HMAC-only by design, so integrators cannot forge spend.

#### Approvals

`x402fetch` treats a `202 { approvalId }` response as "wait". `ApprovalHandler.waitForApproval` polls `GET /v1/agents/approvals/:id` every 5 s for up to 5 min (`approval-handler.ts`). The server-side endpoint exists with IDOR protection and camelCase fields (`agent.controller.ts:973-1012`).

#### x402

`x402fetch(sdk, url, init)` runs these steps in order (`x402-fetch.ts`):

1. `checkPaymentBudget()`
2. The request, with HMAC headers **also sent to the third-party URL**, which leaks the agent id and a signature to non-Relayer hosts
3. On 402: `X402Handler` calls `POST /v1/agents/:id/x402-pay` (custodial: Relayer signs server-side), then retries with `X-PAYMENT` and `X-Idempotency-Key`
4. A `payment` event is emitted

The snapshot SDK's V1 path skips `/x402-pay`. It stamps an EIP-3009 `SIGN_RAW_PAYLOAD_V2` locally with a P-256 key, asks `POST /v1/agents/:id/cosign` for Relayer's second signature, polls Turnkey, and builds an x402 v2 header. This path is **Base mainnet USDC only** (`x402-v1-cosign.ts:46`).

#### Skills

`skills-client` provides:

- `listSkills`: `GET /v1/action/skills`
- `executeSkill`: `x402fetch POST /v1/action/skills/:id/execute`

Both are wrapped as Mastra tool factories that take the SDK through a closure (`packages/skills-client/src/{core,mastra}`). The server routes exist (`relayer-src/apps/api/src/kits/agent/skills/skill.controller.ts:18,35,118`).

### 1.4 Contract drift found in the snapshot (SDK vs. API)

relayer-api wraps every response in `ApiResponseDto { success, message, data, statusCode }` (`relayer-src/apps/api/src/api/utils/response.helper.ts`, `api/dtos/api-response.dto.ts`). `HttpClient` does **not** unwrap it. SDK unit tests mock unwrapped shapes, for example `{ agentId, killSwitch: false }` in `__tests__/kill-switch.test.ts:27`, so they cannot catch this.

| #   | SDK reads                                                                         | API returns (snapshot)                                                                                             | Effect (Inferred, not run)                                                                                                                                                                                                                                                                | Fixed in kit fork?                |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| D1  | `status.killSwitch` at top level (`kill-switch.ts:43`)                            | `data.killSwitch` (`agent.controller.ts:1384-1415`)                                                                | `isActive` is always `false`. The client-side kill switch never trips from the flag. A **killed** agent still gets blocked indirectly, because `AgentAuthGuard` returns 401 `agent_killed`, the poll throws, and the reachability check fails. Pause and suspend statuses are never seen. | **No**                            |
| D2  | `response.status` (`approval-handler.ts:27-36`)                                   | `data.status`                                                                                                      | The approval poll never matches and always ends in `ApprovalTimeoutError` after 5 min                                                                                                                                                                                                     | **No**                            |
| D3  | `budget.infra.exhausted`                                                          | `data.categories[]` (`budget.service.ts:184-226`)                                                                  | `TypeError` on every `checkPaymentBudget()`                                                                                                                                                                                                                                               | Yes (kit `budget-guard.ts:29-32`) |
| D4  | x402-pay body `{paymentRequirement, idempotencyKey}`                              | DTO `{resource_url, amount, recipient, chain?, memo?, cluster?, idempotencyKey?}` (`dtos/x402-pay.dto.ts`)         | 400 validation error                                                                                                                                                                                                                                                                      | Yes (kit `x402-handler.ts`)       |
| D5  | `cosignResp.status` (`x402-v1-cosign.ts:188`)                                     | `data.status` (`agent.controller.ts:1588-1620`)                                                                    | Every V1 cosign is treated as refused (`RELAYER_REFUSED`)                                                                                                                                                                                                                                 | N/A (V1 not in kit)               |
| D6  | `sign-intent.ts` expects `{ coSigned: boolean }`                                  | `{ data: { status: 'co_signed' } }`                                                                                | Transport must adapt (the interface is injectable)                                                                                                                                                                                                                                        | N/A                               |
| D7  | `relayerMastraHook` reads `step.usage.promptTokens` (`relayer-mastra-hook.ts:41`) | AI SDK v5+ usage uses `inputTokens` and `outputTokens` (`tracked-model.ts` already uses `usage.inputTokens.total`) | Hook likely emits zero tokens (Unverified at runtime)                                                                                                                                                                                                                                     | No                                |
| D8  | BI tools POST `/v1/agents/:id/notifications` and `/reports`                       | No such routes in `agent.controller.ts` or `skill.controller.ts` (grep)                                            | `alert-emitter` and `daily-report` delivery fail. The kit spec lists them as won't-fix M11/M12 (`kit/docs/specs/sdk-api-alignment.md:40-41`)                                                                                                                                              | No                                |

Takeaway for Pickler: the pattern (HMAC, advisory client guards, authoritative server reservation, fail-closed payments) is sound. The client code must not be copied without an envelope-unwrapping layer and contract tests against real response fixtures.

---

## 2. What is useful for Pickler agents

Target capabilities: (a) research markets, (b) publish calls publicly, (c) trade perps on Perpl (Monad) under enforced limits.

| Asset                                                                                                             | (a) Research                                                  | (b) Post calls                    | (c) Trade under limits                                                                                                 | Verdict                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `agent-sdk` `HttpClient` + HMAC                                                                                   | —                                                             | —                                 | Signed calls to a Pickler control plane or authorization API                                                           | **High** (adapt to WebCrypto)                                                                           |
| `agent-sdk` `BudgetGuard` (kit), `KillSwitch`, `errors.ts`                                                        | Token budget                                                  | —                                 | Pre-flight guards and typed errors (`BudgetExhaustedError`, `KillSwitchActiveError`, `PolicyViolationError`)           | **High** as patterns and types. Must be redesigned as stateless for Workers                             |
| `agent-sdk` `EventBatcher` + `tracked-model.ts`                                                                   | LLM cost attribution                                          | —                                 | Spend/audit trail                                                                                                      | **Medium** (move sink to Queues / `waitUntil`)                                                          |
| `agent-sdk` `ApprovalHandler`                                                                                     | —                                                             | Human approval before publishing  | Human approval above a threshold                                                                                       | **Medium**. The idea transfers; polling does not (use Workflows `waitForEvent`/sleep)                   |
| `agent-sdk` `x402fetch` / `X402Handler`                                                                           | Pay-per-call data APIs                                        | —                                 | —                                                                                                                      | **Low/optional**. Only if Pickler buys x402 data. Do not forward HMAC headers to third parties          |
| `agent-sdk` V1 cosign / `sign-intent` / Turnkey stampers                                                          | —                                                             | —                                 | Design reference for a two-party authorization gate (claimed intent vs. actual payload, then governance, then co-sign) | **Reference only**. Solana and Base-USDC shaped; Perpl on Monad is neither                              |
| `agent-sdk` LLM wrappers / Mastra hook                                                                            | Token tracking                                                | —                                 | —                                                                                                                      | Low. `tracked-model.ts` is the better pattern                                                           |
| `skills-client` `listSkills`                                                                                      | Discover Relayer skills                                       | —                                 | —                                                                                                                      | Low (only if Relayer skill registry is used)                                                            |
| `skills-client` `executeSkill` tool                                                                               | —                                                             | —                                 | **Anti-pattern for Pickler**: a generic "execute any paid skill" tool exposed to the model                             | Exclude                                                                                                 |
| `relayer-tools/agent-info` (`get-agent-budget`, wallet balance, analytics)                                        | Agent can see its own limits                                  | —                                 | Read-only visibility of remaining budget                                                                               | **High** as a read-only tool (the envelope adapter is already correct: `get-agent-budget.ts`)           |
| `relayer-tools/payments` (`create-payment`, quotes, beneficiaries)                                                | —                                                             | —                                 | Exposes money movement directly to the model (`createCreatePaymentTool`)                                               | Exclude (violates "no generic financial tool")                                                          |
| `agent-skills/deterministic/sanitize-untrusted`                                                                   | Neutralize prompt injection in scraped market content         | Same for quoted sources           | —                                                                                                                      | **High**, pure                                                                                          |
| `agent-skills/deterministic/validate-claims`                                                                      | Evidence-locked claims (source URL membership, $-amount scan) | Anti-hallucination before posting | —                                                                                                                      | **High** (adapt types)                                                                                  |
| `agent-skills/deterministic/prompt-hash`                                                                          | —                                                             | —                                 | Versioned decision provenance (`promptHash`)                                                                           | **High** (swap `node:crypto` for WebCrypto)                                                             |
| `agent-skills/deterministic/budget`                                                                               | Per-run spend cap with record-before-accrue                   | —                                 | Per-decision cost cap                                                                                                  | **Medium**, pure                                                                                        |
| `agent-skills/deterministic/research-helpers`                                                                     | `dedupeUrls`, `summarizeSignals`                              | —                                 | —                                                                                                                      | Medium, pure                                                                                            |
| `agent-skills/deterministic/forbidden-phrases`                                                                    | —                                                             | Content lint for public posts     | —                                                                                                                      | Medium (phrase list is sales-oriented)                                                                  |
| `agent-skills/deterministic/research-pipeline`                                                                    | Orchestration shape with dependency injection                 | —                                 | —                                                                                                                      | Pattern only. Hardcodes "Brazil block" and contact semantics                                            |
| `agent-skills/llm/*` (score, triage, extract-signals)                                                             | `generateObject` + prompt-hash + cache-floor pattern          | —                                 | —                                                                                                                      | Pattern only. Prompts are B2B-sales specific                                                            |
| content-agent patterns (suspend/resume approval, config coercion, `FOR UPDATE` budget, audit log, webhook routes) | —                                                             | Approve-then-publish flow         | Atomic spend cap, decision audit                                                                                       | **High** as patterns (Postgres-bound code)                                                              |
| `packages/tenancy` (Drizzle + pg RLS GUC)                                                                         | —                                                             | —                                 | —                                                                                                                      | Exclude for now. Pickler uses Supabase RPC over `fetch` (`pickler/docs/architecture.md` "Data storage") |

---

## 3. Cloudflare feasibility

### 3.1 Can `@mastra/core` run in Workers?

**Versions in use:** `^1.24.0` in the snapshot. The kit lock resolves `1.24.0` for the SDK and skills-client dev dependencies and `1.35.0` for content-agent (`kit/pnpm-lock.yaml:1246,1252`). Pickler should target the newer line (≥1.35) because it is the one proven with zod 4 and `@mastra/pg`.

**Evidence from the installed `@mastra/core@1.35.0`** (Verified, installed pkg):

- `package.json` `engines: { node: ">=22.13.0" }`. Dependencies include `execa`, `ws`, `dotenv`, `@modelcontextprotocol/sdk`, `hono`, `croner`, `xxhash-wasm`, `gray-matter`, `chat`.
- Static-import trace from `dist/*/index.js`, following relative chunks only:
  - `@mastra/core/tools`: 7 files, **no Node built-ins** (only `@mastra/schema-compat`, `stream`). The tools layer is portable.
  - `@mastra/core/agent` and `@mastra/core/workflows`: ~50 files that statically import `child_process, crypto, events, fs, fs/promises, module, os, path, stream, url`, and bare `ws`.
  - `@mastra/core/mastra`: the same set plus `async_hooks`.
  - `child_process`/`exec(` usage sits in workspace/sandbox chunks (for example `dist/chunk-P4AZAEQP.js`). It is reachable statically from the agent entry, even if it is never called.

Conclusion:

- A Mastra `Agent` in a Worker needs `compatibility_flags = ["nodejs_compat"]`, and the bundle must tolerate the static imports of `child_process`, `module`, `os`, `fs`, and `ws`.
- **Unverified:** whether current workerd `nodejs_compat` supplies importable stubs for all of these, and whether `ws` resolves to its browser stub under wrangler's esbuild conditions.
- **Unverified:** Mastra ships a Cloudflare deployer (`@mastra/deployer-cloudflare`) and Cloudflare storage adapters. They are not installed in either repo, and their compatibility with core 1.35 could not be checked offline.

**This is the #1 gating risk. The first porting task is a spike** (§4.2 step 0). If the spike fails, the fallback is a single Cloudflare Container that runs the Node Mastra build, fronted by a Worker. The architecture constraints allow this only if it is unavoidable.

### 3.2 Node-only code in the port candidates (Verified, code)

| File                                                         | Node-only construct                                                                                     | Workers impact                                                                                                                                   | Fix                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `agent-sdk/core/http-client.ts:1`                            | `node:crypto` `createHmac`, `createHash`                                                                | Works under `nodejs_compat` (Unverified). Not portable without the flag                                                                          | Port to WebCrypto (`crypto.subtle.importKey` + `sign('HMAC')`, `digest('SHA-256')`). This makes `buildAuthHeaders` async |
| `agent-sdk/core/kill-switch.ts:25-27`                        | Module-lifetime `setInterval(...).unref()`                                                              | Background timers do not outlive a request. `.unref` may not exist on workerd timer handles (Unverified). Promises cannot cross request contexts | Remove the poller. Read state per invocation (Durable Object, KV with a short TTL, or one HTTP read)                     |
| `agent-sdk/core/event-batcher.ts:97-98`                      | Same `setInterval().unref()` plus an in-memory buffer                                                   | Buffer is lost between invocations                                                                                                               | Flush per invocation with `ctx.waitUntil`, or `env.EVENTS_QUEUE.send()`                                                  |
| `agent-sdk/core/relayer-sdk.ts:110-114,216-226`              | Constructor starts pollers. `process.on('SIGTERM'/'beforeExit')`                                        | Side effects at import/construction time. No process signals in Workers                                                                          | Build per request from `env`, with no auto-start or shutdown hooks                                                       |
| `agent-sdk/core/approval-handler.ts`                         | 5-minute `setTimeout` poll loop                                                                         | Wastes wall time and subrequests, and may exceed limits                                                                                          | Workflows `step.waitForEvent` or `step.sleep` loop (Unverified API names; confirm against current Workflows docs)        |
| `agent-sdk/core/signing/key-store.ts`                        | `node:fs`, `scryptSync`                                                                                 | Not applicable in Workers                                                                                                                        | Exclude                                                                                                                  |
| `agent-sdk/core/signing/local-keygen.ts`                     | `generateKeyPairSync`                                                                                   | —                                                                                                                                                | Exclude, or rewrite on `crypto.subtle.generateKey` if ever needed                                                        |
| `agent-skills/deterministic/prompt-hash/index.ts:16`         | `node:crypto` sha256                                                                                    | Same as the HTTP client                                                                                                                          | WebCrypto (async)                                                                                                        |
| `apps/agent/src/mastra/index.ts:15-19`                       | `LibSQLStore url: 'file:./mastra.db'`                                                                   | No local filesystem persistence                                                                                                                  | Replace (see §3.3)                                                                                                       |
| `apps/agent/src/mastra/cron.ts`, content-agent `src/cron.ts` | `node-cron` in-process                                                                                  | No long-lived process                                                                                                                            | Cron Triggers → `scheduled()` handler                                                                                    |
| `@mastra/loggers` `PinoLogger`                               | `pino` + `pino-pretty` transports (Verified, installed pkg: deps `pino ^10.3.1`, `pino-pretty ^13.1.3`) | Transports use worker threads (Unverified in workerd)                                                                                            | Use Mastra's console logger or a tiny JSON `console.log` logger                                                          |
| content-agent `http.ts`                                      | Mastra embedded Hono server (`registerApiRoute`)                                                        | The Worker `fetch` handler replaces it                                                                                                           | Use Hono directly in the Worker, or the Mastra deployer's server                                                         |
| `@turnkey/api-key-stamper` (snapshot SDK dependency)         | Unknown                                                                                                 | Unverified                                                                                                                                       | Excluded anyway                                                                                                          |

### 3.3 Storage options for Mastra state and Pickler records

Separate two kinds of data:

1. **Pickler domain records** (decisions, config versions, proposals, authorizations, audit). These belong in Pickler's own schema behind core ports. The existing Pickler rule is Supabase Postgres reached through PostgREST RPC with plain `fetch`, which already runs on Workers (`pickler/docs/architecture.md`).
2. **Mastra-managed state** (workflow snapshots, threads/messages, traces). This is needed only if Pickler uses Mastra memory or Mastra's own suspend/resume.

| Option                                                                  | Where it runs        | Fit                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Postgres via RPC over `fetch` (existing Pickler adapter style) | Workers              | **Best for domain records**                                                                               | No TCP driver. Atomic reservations as SQL functions (content-agent `budget-repo.ts` `FOR UPDATE` pattern, moved into an RPC)                                                                                                                                                                                                                                                                  |
| `@mastra/pg` `PostgresStore` → Supabase through **Hyperdrive**          | Workers + Hyperdrive | Candidate for Mastra state                                                                                | `pg@8.20.0` has optional dependency `pg-cloudflare@1.3.0` (Verified, installed pkg), so a TCP socket path exists. `@mastra/pg` also depends on `async-mutex` and `xxhash-wasm`. Whether `PostgresStore` works under workerd is Unverified. `init()` runs DDL, so provision the schema at deploy time with `disableInit` at runtime (`kit/docs/architecture.md`). Use an isolated `schemaName` |
| `@mastra/libsql` → remote Turso over HTTP                               | Workers              | Possible                                                                                                  | `@libsql/client` has fetch/hrana clients (Verified, installed pkg: `@libsql/hrana-client`, `@libsql/isomorphic-fetch`), but `libsql@0.5.29` native binaries are also present. The web client entry must be selected (Unverified). Adds a second database vendor                                                                                                                               |
| D1 via a Mastra D1 store                                                | Workers              | Possible for Mastra state                                                                                 | Store package not installed. Unverified API and version compatibility. SQLite semantics. Separate from Supabase, so domain joins are impossible                                                                                                                                                                                                                                               |
| Durable Objects (SQLite-backed)                                         | Workers              | **Best for per-agent hot state**: kill switch flag, open-exposure counters, idempotency keys, rate limits | Single-threaded per object gives atomic reserve/commit/refund without Redis Lua. This replaces what relayer-api does with `budget-check.lua`                                                                                                                                                                                                                                                  |
| No Mastra storage                                                       | Workers              | **Recommended for the first slice**                                                                       | Use Mastra only for `Agent` + tools. Cloudflare Workflows provides durability. Decisions go to Pickler's schema                                                                                                                                                                                                                                                                               |

### 3.4 Long-running work, approvals, and cron

- **Cron:** Cloudflare Cron Triggers call `scheduled(event, env, ctx)`. They replace `node-cron` schedules one for one (`0 8 * * *`, `0 * * * *`). The content-agent's 5-second poller has no Cron equivalent (the minimum is 1 minute; Unverified current limit). It should become push-based: webhook → Queue → consumer.
- **Durable multi-step runs:** Cloudflare Workflows (`step.do` with retries, `step.sleep`, event waits; Unverified exact API names) replace Mastra `createWorkflow` + Postgres snapshot durability.
  - Each LLM call (`agent.generate`) goes inside a `step.do`, so a retry does not repeat completed side effects.
  - Human approval (content-agent `suspend-for-approval`, SDK `ApprovalHandler`) becomes a Workflow waiting for an external event, delivered by an authenticated HTTP handler.
- **Queues:** batched telemetry (replacing `EventBatcher`), webhook fan-in (replacing the inbox poller), and fan-out across agents from a single cron tick.
- **Limits to design around** (Unverified figures; confirm on current docs): CPU-time per invocation, subrequest caps (retries and polling count toward them), and Workflow step/state size limits. Keep LLM calls one per step, and avoid polling loops.
- **Mastra workflows on Workers:** keep them out of the first slice. Using both Mastra's workflow engine and Cloudflare Workflows duplicates durability and doubles the failure modes.

### 3.5 Summary of blockers

| #   | Blocker                                                                                          | Evidence                                                          | Severity                                    | Mitigation                                                                    |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| B1  | Mastra `agent`/`workflows` entries statically import `child_process`, `fs`, `module`, `os`, `ws` | Import trace of installed `@mastra/core@1.35.0`                   | **High until spiked**                       | Spike with `nodejs_compat` and a dry-run wrangler bundle. Fallback: Container |
| B2  | SDK constructor starts background pollers and registers `process` signal handlers                | `relayer-sdk.ts:110-114,216-226`                                  | High (breaks per-request model)             | Stateless redesign                                                            |
| B3  | File LibSQL storage                                                                              | `apps/agent/src/mastra/index.ts:15-19`                            | High                                        | No Mastra storage, or Postgres via Hyperdrive, or D1                          |
| B4  | `node-cron`, including a 5 s poller                                                              | `apps/agent/src/mastra/cron.ts`, content-agent `src/cron.ts:1262` | Medium                                      | Cron Triggers plus Queues                                                     |
| B5  | Envelope contract drift (D1–D8)                                                                  | §1.4                                                              | High (correctness, enforcement)             | Unwrap layer plus fixture-based contract tests                                |
| B6  | `node:crypto` in HMAC and prompt-hash                                                            | `http-client.ts:1`, `prompt-hash/index.ts:16`                     | Low                                         | WebCrypto                                                                     |
| B7  | pino transports                                                                                  | `@mastra/loggers@1.1.1` deps                                      | Low                                         | Console logger                                                                |
| B8  | Relayer signing and x402 paths are Solana- or Base-USDC-only                                     | `x402-v1-cosign.ts:46`; `architecture-current.md` §7              | High for Perpl (no reusable execution path) | New typed Perpl authorization and execution adapter (other workstream)        |
| B9  | npm workspaces in Pickler vs. `workspace:*` in copied manifests                                  | `pickler/package.json`                                            | Low                                         | Rewrite dependency specs                                                      |

---

## 4. File dispositions and porting order

Legend:

- **COPY-AS-IS**: copy verbatim; only import paths or module syntax change.
- **ADAPT**: copy, then change behavior or API.
- **EXCLUDE**: do not port. It may still serve as a design reference ("REF").

Proposed Pickler placement follows Pickler's existing layering:

- `packages/core`: domain, ports, and use cases. No provider SDKs.
- `packages/infrastructure`: adapters.
- A new Worker app, suggested `apps/agents`: Mastra agent, tools, Workflow, Cron, and the composition root.

This layout is a proposal and does not exist yet.

### 4.1 Disposition table

**`@relayerfi/agent-sdk`**: take the kit fork (`kit/packages/agent-sdk`) unless noted otherwise.

| File                                                                | Disposition                                          | Target (proposed)                                               | Notes                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/errors.ts`                                                | **COPY-AS-IS** (then rename `Relayer*`)              | `packages/core/src/shared/agent-errors.ts`                      | Pure classes. Combine snapshot's `PolicyViolationError` and `ConsensusTimeoutError` with the kit version                                                    |
| `src/core/version.ts`                                               | COPY-AS-IS                                           | infrastructure                                                  | Trivial                                                                                                                                                     |
| `src/core/types.ts`                                                 | ADAPT                                                | core ports / infrastructure DTOs                                | Keep `Logger`, event and budget shapes. Add an `ApiEnvelope<T>` type. Drop V1 Turnkey fields                                                                |
| `src/core/http-client.ts`                                           | ADAPT                                                | `packages/infrastructure/src/control-plane/hmac-http-client.ts` | WebCrypto HMAC (async). Unwrap `{data}` envelope (D1–D5). Sign path without query or reject queries. Idempotency-key header support. Keep retry and backoff |
| `src/core/__tests__/hmac-auth.test.ts`                              | ADAPT                                                | infrastructure test                                             | Keep the **known vector** (`4670d3c5…`). Port from vitest to `node:test` (Pickler's `npm test`)                                                             |
| `src/core/budget-guard.ts` (kit)                                    | ADAPT                                                | infrastructure adapter behind a core `SpendLimits` port         | Already envelope-correct. Make stateless                                                                                                                    |
| `src/core/kill-switch.ts`                                           | ADAPT                                                | infrastructure adapter behind a core `AgentControl` port        | Remove `setInterval`. One read per decision, fail closed on error. Read `data.killSwitch` **and** `data.status !== 'active'`                                |
| `src/core/event-batcher.ts`                                         | ADAPT                                                | infrastructure `QueueEventSink`                                 | Keep `mapToBackendEvent` and the retryable-vs-drop classification. Replace the timer with Queue send or `waitUntil`                                         |
| `src/core/approval-handler.ts`                                      | ADAPT (logic only)                                   | Workflow step                                                   | Replace the polling loop with Workflow event wait. Keep the typed outcomes (`ApprovalRejectedError`, `ApprovalTimeoutError`)                                |
| `src/core/relayer-sdk.ts`                                           | ADAPT (heavy)                                        | `createControlPlane(env)` factory                               | No constructor side effects, no `process.on`, no static singleton flag                                                                                      |
| `src/core/x402-fetch.ts`, `x402-handler.ts` (kit)                   | EXCLUDE for now (ADAPT later if paid data is needed) | —                                                               | If adopted, never forward HMAC headers to third-party URLs                                                                                                  |
| `src/core/x402-v1-cosign.ts` (snapshot)                             | EXCLUDE (REF)                                        | —                                                               | Reference for "claimed intent vs. actual payload" verification. Base USDC only; D5 bug                                                                      |
| `src/core/sign-intent.ts` (snapshot)                                | EXCLUDE (REF)                                        | —                                                               | Useful shape: injectable transport, typed refusal codes. Solana-specific input                                                                              |
| `src/core/turnkey-stamper.ts`, `turnkey-http-stamper.ts` (snapshot) | EXCLUDE                                              | —                                                               | Custody design is out of scope for this slice. Pickler architecture requires an explicit custody design first                                               |
| `src/core/signing/key-store.ts`, `local-keygen.ts` (snapshot)       | EXCLUDE                                              | —                                                               | `node:fs` and `node:crypto` keygen. Workers secrets and bindings replace them                                                                               |
| `src/core/wrappers/wrap-{anthropic,openai,google}.ts`               | EXCLUDE                                              | —                                                               | Mastra goes through the AI SDK. Use the tracked-model pattern instead                                                                                       |
| `src/mastra/relayer-mastra-hook.ts`                                 | EXCLUDE                                              | —                                                               | Stale usage fields (D7)                                                                                                                                     |
| `src/core/__tests__/*` (others)                                     | ADAPT selectively                                    | —                                                               | Rewrite fixtures to real **envelope** shapes. Keep the retry and drop classification tests for the event sink                                               |
| `examples/*`, `scripts/probe-v1-consensus.ts` (snapshot)            | EXCLUDE                                              | —                                                               | —                                                                                                                                                           |

**`@relayerfi/skills-client`**

| File                                                            | Disposition                                                    | Notes                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/list-skills.ts`, `src/mastra/list-skills-tool.ts`     | EXCLUDE (ADAPT later if the Relayer skill registry is adopted) | Read-only; harmless                                                                                                                     |
| `src/core/execute-skill.ts`, `src/mastra/execute-skill-tool.ts` | **EXCLUDE**                                                    | Generic paid-execution tool exposed to the model conflicts with the "typed authorization, no generic signing/spending tool" requirement |
| `src/core/types.ts`                                             | EXCLUDE                                                        | —                                                                                                                                       |

**`@relayerfi/relayer-tools`** (kit only)

| File                                                                               | Disposition                                               | Notes                                                                                                                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent-info/get-agent-budget.ts`                                               | **ADAPT** → `apps/agents/src/tools/get-trading-limits.ts` | The "existing tool" for the slice. Keep the factory-closure pattern and the envelope `toLayer` adapter. Point it at the Pickler control-plane port |
| `src/agent-info/get-agent-wallet-balance.ts`, `get-agent-analytics.ts`, `types.ts` | ADAPT later                                               | Read-only visibility tools                                                                                                                         |
| `src/payments/*`                                                                   | **EXCLUDE**                                               | Cross-border payouts; money-moving tool exposed to the model                                                                                       |

**`@relayerfi/agent-skills`** (kit only)

| Skill                                                                                                                                                                                   | Disposition    | Notes                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `deterministic/sanitize-untrusted`                                                                                                                                                      | **COPY-AS-IS** | Pure, "No env, no DB, no LLM, no node:crypto" (header)                                                                              |
| `deterministic/research-helpers`                                                                                                                                                        | COPY-AS-IS     | Pure                                                                                                                                |
| `deterministic/budget`                                                                                                                                                                  | COPY-AS-IS     | Pure. Inject a `recordCost` that writes to Pickler's ledger                                                                         |
| `deterministic/prompt-hash`                                                                                                                                                             | **ADAPT**      | WebCrypto, async. Keep CRLF normalization and 16-hex truncation (consider full 64-hex for audit)                                    |
| `deterministic/validate-claims`                                                                                                                                                         | ADAPT          | Generalize `SignalRef` to market evidence (source URL, observed price, timestamp)                                                   |
| `deterministic/forbidden-phrases`                                                                                                                                                       | ADAPT          | Keep the escaped word-boundary matcher. Replace `phrases.json` with public-post compliance terms (for example "guaranteed returns") |
| `deterministic/research-pipeline`                                                                                                                                                       | EXCLUDE (REF)  | Sales and contact specific ("Brazil block")                                                                                         |
| `deterministic/{contact-classifier, segment-routing, draft-schema, score-schema, triage-schema, triage-router, lemlist-reply-event-adapter, hard-suppression-keywords, parse-ooo-date}` | EXCLUDE        | Proprietary to sales outbound                                                                                                       |
| `llm/{extract-signals, score, triage}`                                                                                                                                                  | EXCLUDE (REF)  | Keep the pattern: externalized prompt + zod schema + `generateObject` + prompt hash + temperature 0                                 |

**Relayer `apps/agent`** (snapshot)

| File                                                                             | Disposition                   | Notes                                                                                                                                        |
| -------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mastra/tracked-model.ts`                                                    | **ADAPT**                     | Keep the `doGenerate`/`doStream` wrapper and the "tracking must never break the agent" rule. Emit to the event sink and include `decisionId` |
| `src/mastra/agents/bi-agent.ts`                                                  | ADAPT (shape only)            | Agent definition template                                                                                                                    |
| `src/mastra/index.ts`                                                            | ADAPT                         | No `LibSQLStore`, no `PinoLogger`                                                                                                            |
| `src/mastra/sdk.ts`                                                              | ADAPT                         | Per-request factory from `env`, not module env with `!`                                                                                      |
| `src/mastra/tools/types.ts`                                                      | ADAPT (`ApiEnvelope<T>` idea) | —                                                                                                                                            |
| `src/mastra/tools/on-chain-fetcher.ts`                                           | EXCLUDE                       | Superseded by kit `relayer-tools/agent-info`                                                                                                 |
| `src/mastra/tools/analytics-fetcher.ts`, `alert-emitter.ts`, `html-formatter.ts` | EXCLUDE                       | BI-specific; endpoints missing (D8)                                                                                                          |
| `src/mastra/workflows/*`                                                         | EXCLUDE (REF)                 | Replaced by Cloudflare Workflows                                                                                                             |
| `src/mastra/cron.ts`, `src/index.ts`                                             | EXCLUDE                       | Replaced by Cron Triggers                                                                                                                    |
| `docs/hmac-auth-contract.md`                                                     | **COPY-AS-IS** (as a doc)     | Contains the test vector. Add a note on the envelope and query strings                                                                       |
| `docs/production-deploy.md`, `docker-compose.yml`, `.env.example`                | EXCLUDE                       | Stale or VPS-specific                                                                                                                        |
| `scripts/verify-hmac-auth.ts`, `smoke-test.ts`                                   | ADAPT later                   | Useful as live contract probes against a staging control plane                                                                               |
| `scripts/e2e-test-run.ts`, `verify-endpoints.ts`, `check-bundle-size.ts`         | EXCLUDE                       | —                                                                                                                                            |

**Kit `apps/content-agent` (patterns only; Postgres/Drizzle-bound)**

| File                                                            | Disposition      | Notes                                                                         |
| --------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `src/lib/approval-decision.ts`                                  | ADAPT            | Pure state machine. Model the proposal lifecycle the same way                 |
| `src/db/agent-config-repo.ts`                                   | ADAPT (REF)      | Coerce-with-defaults. Pickler adds immutable versions and a content hash      |
| `src/db/budget-repo.ts`                                         | ADAPT (REF)      | Move `FOR UPDATE` check-and-increment into a Supabase RPC or a Durable Object |
| `src/db/audit-log.ts`                                           | ADAPT (REF)      | Append-only decision and audit events                                         |
| `src/mastra/workflows/cycle.ts` (suspend-for-approval)          | EXCLUDE (REF)    | Semantics move to a Workflow event wait                                       |
| `src/mastra/http.ts`                                            | EXCLUDE (REF)    | Webhook plus `/healthz` route shapes                                          |
| `src/lib/clients/typefully.ts`, `src/lib/publish/push-draft.ts` | Out of this area | Relevant to "post calls publicly"; see the publishing workstream              |
| `packages/tenancy/*`                                            | EXCLUDE          | pg GUC/RLS for Drizzle. Pickler uses Supabase RPC                             |

### 4.2 Dependency-ordered porting sequence

0. **Spike (gate), no product code.** Build a throwaway Worker with `nodejs_compat` that imports `@mastra/core/agent` (≥1.35) and `@ai-sdk/anthropic`, defines one `createTool`, and runs `agent.generate` against a mocked model and against a real one. Record the bundle size, the Node module stub results, and cold-start time. Also try `@mastra/core/tools` on its own.
   - Exit criteria: bundling succeeds, no runtime `child_process`/`fs` errors are hit on the agent path, and the size is within the plan limit.
   - If the spike fails, try the Mastra Cloudflare deployer. If that also fails, move to a single Container.
1. **Core domain and ports** (`packages/core/src/features/trading/`, new code informed by `errors.ts` and `types.ts`): `AgentConfigVersion`, `TradeIntent`, `Decision`, `AuthorizationResult`, and the pure `evaluateIntentAgainstLimits` policy. Ports: `AgentConfigRepository`, `DecisionLog`, `AgentControl`, `TradeAuthorizationService`, `Clock`, `IdGenerator`. Errors come from `errors.ts` (COPY-AS-IS, renamed).
2. **Hashing utilities:** the WebCrypto `prompt-hash` (ADAPT) plus a canonical-JSON `configHash`. Tests use a fixed vector.
3. **HMAC HTTP client** (ADAPT of `http-client.ts`): envelope unwrap, WebCrypto HMAC, the ported known-vector test.
4. **Control-plane adapters** (ADAPT `budget-guard.ts` from the kit, `kill-switch.ts`): stateless implementations of `AgentControl`, plus envelope-fixture contract tests (D1, D3).
5. **Persistence adapters:** `SupabaseDecisionLog`, `SupabaseAgentConfigRepository` over RPC (existing Pickler adapter style), and SQL migrations for `agent_config_versions`, `agent_decisions`, `trade_proposals`.
6. **Authorization service adapter:** a first `ProposalOnlyAuthorizationService` that validates, reserves idempotently, persists a proposal, and returns `pending_approval` or `rejected`. It never executes. The real Perpl execution adapter comes later from the trading/custody workstream.
7. **Pure skills:** `sanitize-untrusted` and `research-helpers` (COPY-AS-IS), `budget` (COPY-AS-IS), `validate-claims` (ADAPT).
8. **Worker app** (`apps/agents`): `tracked-model.ts` (ADAPT), the `get-trading-limits` tool (ADAPT of `get-agent-budget.ts`), the `propose-trade` tool (new, typed), the `market-analyst` agent (ADAPT of `bi-agent.ts` shape), and a composition root that builds adapters from `env` per invocation.
9. **Durability:** a Cloudflare Workflow `research-and-propose` plus a Cron Trigger (replaces `cron.ts`), and a Queue-backed event sink (ADAPT `event-batcher.ts`).
10. **Later, optional:** approval event handler (ADAPT `approval-handler.ts` semantics), `x402` (kit handler, ADAPT) if paid data is needed, read-only `list-skills`, and a Durable Object for per-agent exposure counters.

---

## 5. Minimal vertical slice for Pickler

Goal: one Mastra agent that (1) uses an existing tool, (2) records a decision tied to a versioned config, and (3) proposes a financial action through a typed authorization service. The model has no signing, transfer, or generic-execute tool.

### 5.1 Flow

```
Cron Trigger (or authenticated POST /agents/:id/run)
  └─ Workflow "research-and-propose" (instance id = idempotency root)
       step 1 load-config        → AgentConfigRepository.getActive(agentId) → {versionId, version, configHash, limits, promptTemplate}
       step 2 control-check      → AgentControl.assertActive(agentId)       (kill switch / paused → stop, no LLM spend)
       step 3 analyze            → mastraAgent.generate(prompt, { tools: [get-trading-limits, propose-trade] })
                                    tool get-trading-limits → read-only limits and remaining budget
                                    tool propose-trade      → ProposeTrade use case (below)
       step 4 finalize           → DecisionLog.complete(decisionId, outcome), emit events
```

Inside `propose-trade`, which the model calls with typed arguments only, the use case `createProposeTrade(deps)` runs these steps:

1. Parse `TradeIntent` with zod. Enums for market and side, positive bounded numbers, no free-form fields that reach execution.
2. Load the pinned config version from workflow state (**not** from model input).
3. `evaluateIntentAgainstLimits(intent, config.limits)`: a pure check of the market allowlist, max notional, max leverage, and max slippage. On rejection, record the decision and return `{ status: 'rejected', reasons }` with no external call.
4. `AgentControl.assertActive()`, failing closed.
5. `DecisionLog.record({ agentId, configVersionId, configHash, promptHash, modelId, inputsDigest, intent, rationale, evidenceUrls })`.
6. `TradeAuthorizationService.requestAuthorization({ decisionId, intent, idempotencyKey: \`${workflowInstanceId}:${decisionSeq}\` })`. In the slice this returns `pending_approval`(or`rejected`) and persists a proposal row. Nothing is signed and nothing is sent to Perpl.
7. Return `{ status, proposalId, reasons }` to the model.

### 5.2 Proposed types (sketch, not existing code)

```ts
// packages/core/src/features/trading/domain/trade-intent.ts  (proposed)
export type PerpSide = "long" | "short";
export interface TradeIntent {
  market: string; // must be in config.limits.allowedMarkets
  side: PerpSide;
  notionalUsd: number; // > 0, <= limits.maxNotionalUsd
  leverage: number; // >= 1, <= limits.maxLeverage
  maxSlippageBps: number; // <= limits.maxSlippageBps
  thesis: string; // stored, never executed
  evidenceUrls: string[]; // validated with validate-claims (adapted)
}

// packages/core/src/features/trading/ports/trade-authorization-service.ts  (proposed)
export type AuthorizationResult =
  | { status: "pending_approval"; proposalId: string; expiresAt: string }
  | { status: "rejected"; reasons: string[] };
export interface TradeAuthorizationService {
  requestAuthorization(input: {
    agentId: string;
    decisionId: string;
    configVersionId: string;
    intent: TradeIntent;
    idempotencyKey: string;
  }): Promise<AuthorizationResult>;
}

// packages/core/src/features/trading/ports/decision-log.ts  (proposed)
export interface DecisionRecord {
  id: string;
  agentId: string;
  configVersionId: string;
  configHash: string;
  promptHash: string;
  modelId: string;
  inputsDigest: string;
  intent: TradeIntent | null;
  outcome: "proposed" | "rejected" | "no_action";
  reasons: string[];
  createdAt: string;
}
```

```ts
// apps/agents/src/mastra/agents/market-analyst.ts  (proposed; shape copied from relayer-src/apps/agent/src/mastra/agents/bi-agent.ts)
export function createMarketAnalyst(deps: AgentDeps) {
  return new Agent({
    id: "market-analyst",
    name: "Pickler Market Analyst",
    instructions: deps.config.promptTemplate, // versioned; hashed into promptHash
    model: deps.trackedModel, // ADAPT of tracked-model.ts
    tools: {
      getTradingLimits: createGetTradingLimitsTool(deps.control), // ADAPT of relayer-tools get-agent-budget
      proposeTrade: createProposeTradeTool(deps.proposeTrade), // typed; calls core use case only
    },
  });
}
```

Invariants to test:

- The agent's tool id set equals exactly `{"get-trading-limits", "propose-trade"}`. A test fails if any tool with `sign`, `transfer`, `execute`, or `pay` in its id appears.
- `propose-trade`'s zod `inputSchema` has no `address`, `calldata`, `privateKey`, `rawTx`, or `url` fields.
- Config version and limits come from workflow state, never from tool input.

### 5.3 Data (proposed SQL; Supabase, accessed via RPC)

- `agent_config_versions(id, agent_id, version int, config jsonb, config_hash text, created_at, UNIQUE(agent_id, version))`. Immutable; a new version for every change.
- `agent_active_config(agent_id PK, config_version_id FK)`
- `agent_decisions(id, agent_id, config_version_id FK, config_hash, prompt_hash, model_id, inputs_digest, intent jsonb, outcome, reasons jsonb, workflow_instance_id, created_at)`. Append-only.
- `trade_proposals(id, decision_id FK UNIQUE, agent_id, idempotency_key UNIQUE, intent jsonb, status CHECK in ('pending_approval','rejected','approved','expired','cancelled'), expires_at, created_at)`
- RPCs: `record_decision`, `request_trade_authorization` (idempotent on `idempotency_key`; enforces limits again server-side in SQL, following Relayer's rule that client checks are advisory), `get_active_agent_config`.

### 5.4 Acceptance criteria

1. The Worker bundles and runs `agent.generate` on Cloudflare (spike step 0 passed).
2. Given config v3 with `maxNotionalUsd = 100`, an intent of 150 USD returns `rejected`. A decision row exists with `config_version_id = v3`, the correct `config_hash`, and `prompt_hash`, and **no** proposal row exists.
3. A valid intent produces exactly one `trade_proposals` row with `pending_approval`. Re-running the same workflow step returns the same `proposalId`, which proves idempotency.
4. With the kill switch active or the agent paused, no LLM call is made and the decision is recorded as `no_action` with reason `agent_inactive`.
5. The model cannot reach signing: the tool registry invariant test passes, and no private key or RPC credential binding exists in the Worker `env` for this slice.
6. The HMAC known-vector test passes on WebCrypto, and the envelope-fixture tests for kill switch and budget pass (drift items D1 and D3 cannot recur).
7. Token usage events carry `decisionId`, and tracking failures never fail the run (the rule from `tracked-model.ts`).

### 5.5 Out of scope for the slice

- Perpl/Monad execution and custody (no Turnkey, no server signing), approval UI, public posting, x402, Mastra memory, and Mastra workflows.
- The Perpl market-data tool. The slice's "research" input can be a fixed fixture or a single read-only fetch passed through `sanitize-untrusted`.

---

## 6. Open questions and unverified items

1. Does `@mastra/core ≥1.35` `agent` bundle and run under workerd `nodejs_compat`, given its static imports (§3.1)? Is `@mastra/deployer-cloudflare` current and compatible? Unverified; spike step 0.
2. Do Cloudflare Workflows event waits (`waitForEvent` or equivalent), and the CPU, subrequest, and step limits, fit the approval and LLM step design? Unverified; confirm against current docs.
3. Does `@mastra/pg` over Hyperdrive work in Workers if Mastra state is ever needed? Unverified.
4. Will Pickler keep calling relayer-api (HMAC client) or run its own control plane? This report assumes a Pickler-owned control plane with the same contract style. If relayer-api is used, drift items D1, D2, and D8 must be fixed upstream or adapted client-side.
5. `relayerMastraHook` token field names under Mastra 1.x (D7). Unverified at runtime.
6. The exact resolved `@mastra/core` version in the Relayer snapshot. There is no lockfile, so it is unverified.

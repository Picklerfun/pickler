# Mastra on Cloudflare Workers: compatibility probe

This experiment reuses the existing Mastra model adapter, tools, prompts, provider adapters and core research runner. It is not a production API, scheduler or durable execution implementation. No Container or Cloudflare Workflow is used.

## Verified locally on 2026-09-17

Wrangler 4.133.0 bundles and runs the service in **workerd**, not a Node.js HTTP server. With Node compatibility, the deployed bundle was approximately 2,025 KiB compressed. Cloudflare accepted deployment and reported 276 ms Worker startup time; this is not end-to-end request latency.

An actual workerd investigation with the configured DashScope model, Exa and Polymarket completed in approximately 70 seconds:

- Run: `91e02cbe-6820-4e80-b7b2-c92163ac2a28`.
- Market: whether Vinicius Junior wins the 2026 Ballon d'Or.
- Result: valid decision v2, `ABSTAIN`.
- Three real Exa searches; all 12 cited IDs occur in retrieved sources.
- PostgreSQL readback matches the HTTP result; alpha cannot read beta's run.
- Reported research usage: 52,345 input and 8,070 output tokens, including 5,949 reasoning tokens. Reasoning is not added again to output. Selection usage is separate.
- Actual process termination was tested with a no-provider held job (`049d9513-2b0a-485d-906c-4a96db13939c`): after workerd restarted, recovery marked it `failed/INTERRUPTED` and preserved its `probe_wait` event. It did not resume.
- A pre-aborted invocation persisted `failed/DEADLINE_OR_CANCELLED` and its runtime snapshot without provider calls.

The probe database is separate from the ordinary pilot. Its records and ignored response files are retained for inspection. These results do not establish a hosted Supabase connection, production quotas/concurrency, durable restart/resumption, or profitability.

## Compatibility correction

The first workerd attempt failed before discovery: Workers rejects Fetch `redirect: "error"`. Provider HTTP calls now use `manual` and reject non-success HTTP responses, including redirects. A regression test verifies redirects are not followed. The failed run is preserved as `8304f6a4-07a5-4ec5-b459-4f5cbdd0d700`; no model call occurred.

The runner's repository dependency is narrowed to the three methods it actually consumes: `agent`, `event`, `finish`. Production admission and ownership checks remain in their existing host. This allows a clearly labeled, ephemeral remote experiment without pretending that request-local evidence is persisted remotely.

## Reproduce locally

Use the repository's supported Node version. From the repository root:

```sh
npm run build:shared
node apps/agent-service/src/cloudflare/client.mjs prepare
node apps/agent-service/src/cloudflare/client.mjs serve --inspector-port 9247
```

Preparation reads the existing ignored agent-service `.env`, requires a local PostgreSQL connection with database-creation permission, creates a unique `pickler_cf_probe_*` database, applies migrations and configures Sports for its beta preset. It writes a dedicated random probe token and required provider variables to ignored `.dev.vars` and `.data/cf-probe.json`. It refuses to overwrite existing files. It does not call providers or change the ordinary pilot database.

From another terminal:

```sh
node apps/agent-service/src/cloudflare/client.mjs health
node apps/agent-service/src/cloudflare/client.mjs interrupt
# Explicit live provider calls and associated costs:
node apps/agent-service/src/cloudflare/client.mjs check
node apps/agent-service/src/cloudflare/client.mjs research
```

The client saves full responses under ignored `.data/` and prints only a summary. Each research request starts a new run. Under exclusive worker ownership, the database probe first marks orphan queued requests `PROBE_REQUEST_INTERRUPTED` without calling providers; previously running jobs become `INTERRUPTED`. This prevents an abandoned request from being claimed in place of the new one. Recovery retains records and their quota usage, and does not retry paid research. Do not automatically retry ambiguous requests. Keep the HTTP request open until the result arrives. This probe deliberately does not return 202 and continue with `waitUntil()`.

To reproduce process interruption without paid calls, start `node apps/agent-service/src/cloudflare/client.mjs hold`, wait for its `probe_wait` event in the isolated database, stop workerd, restart it and invoke `interrupt`. The held run must become `INTERRUPTED` with its event preserved. This test endpoint never contacts providers.

## Remote experiment boundary

`wrangler.probe.jsonc` defines the dedicated development Worker `pickler-mastra-runtime-probe`. Every endpoint requires `Authorization: Bearer PROBE_TOKEN`; no Studio or tenant-token API is exposed. Missing authentication returns 401. Provider calls never happen at startup.

A remote `/research-ephemeral` request executes the same core runner with real providers and request-local records. It returns all evidence to the caller but **does not persist it remotely**, enforce production tenant admission, or recover interrupted requests. This endpoint is only suitable for an operator-controlled compatibility test. `/research` and `/interrupt` instead require the isolated PostgreSQL connection; local PostgreSQL cannot be reached from the deployed Worker.

On 2026-09-17, the operator explicitly authorized uploading `MODEL_API_KEY` and `EXA_API_KEY` to this Worker and retaining both the deployment and its secrets for continued development. Do not delete them as automatic probe cleanup. Prepare an ignored `.data/cf-remote-secrets.json` containing only `MODEL_BASE_URL`, `MODEL_ID`, `MODEL_API_KEY`, `EXA_API_KEY`, and a fresh `PROBE_TOKEN`. Never upload database URLs or the pilot's tenant tokens for the ephemeral test.

```sh
npx wrangler deploy --config apps/agent-service/wrangler.probe.jsonc
npx wrangler secret bulk apps/agent-service/.data/cf-remote-secrets.json --config apps/agent-service/wrangler.probe.jsonc
PROBE_BASE_URL=https://YOUR-PROBE.YOUR-SUBDOMAIN.workers.dev node apps/agent-service/src/cloudflare/client.mjs research-ephemeral
```

## Verified on the deployed Cloudflare Worker

After explicit authorization on 2026-09-17, the configured model and Exa credentials were stored as Cloudflare secrets alongside model configuration and a dedicated probe token. No database credentials or normal tenant tokens were uploaded. The operator requested that the Worker and secrets remain deployed for continued development.

Remote run `fc315df0-3a11-419e-9890-5052b18cd169` completed with HTTP 200 in 89.002 seconds at `https://pickler-mastra-runtime-probe.gilbertsahumada.workers.dev`. It used the actual Mastra model adapter and core runner on Cloudflare, without Containers or Cloudflare Workflows, to research whether Vinicius Junior wins the 2026 Ballon d'Or.

- Valid decision v2: model `ABSTAIN`, final `ABSTAIN`, policy reason `MODEL_ABSTAINED`.
- Three real Exa searches; all 11 cited source IDs match retrieved evidence. No page-reader calls occurred.
- Original assessment and policy evaluation match their corresponding returned events structurally.
- Reported research usage: 50,606 input and 6,187 output tokens, including 4,553 reasoning tokens; selection usage is separate.
- Unauthenticated health access returned 401; authenticated access returned 200 while research was running.
- Full response saved to the operator's ignored `.data/cf-remote-research-ephemeral-1789635993793.json`.

This verifies actual remote execution with real providers. The HTTP request remained open. Evidence was returned and saved locally by the client, not persisted in remote PostgreSQL. Hosted Supabase connectivity, detached execution, crash resumption and production tenant/concurrency controls remain unverified. The retained deployment is still an authenticated development probe, not a production API.

## What remains before production

- Choose a background execution mechanism with an explicit lifetime. An HTTP response does not make subsequent research durable.
- Replace the process-wide session ownership/recovery model before allowing independent concurrent executors. Current restart recovery marks running jobs interrupted; it does not resume a model loop.
- Verify PostgreSQL connectivity in the remote environment. The existing session advisory lock requires direct/session connections, not transaction pooling through Hyperdrive.
- Preserve tenant authorization, permission rechecks, quotas and idempotency in the production entry point; the ephemeral probe is not a replacement.
- Extend the bounded process-interruption probe to ambiguous provider responses, retry policy and load. Never blindly repeat paid model calls after an uncertain failure.
- Keep Studio privileged and separate from the public API.

References: [Workers Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/), [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [HTTP background lifetime](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil), [Hyperdrive transaction pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).

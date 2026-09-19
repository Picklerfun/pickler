# Cloudflare runtime experiment

Read the root and agent-service instructions. This is a bounded compatibility probe, not a production API or replacement worker. Reuse the actual Mastra model adapter, capability adapters and core runner. Never silently substitute models or fabricate live evidence. Keep credentials in ignored local files or Cloudflare secrets.

Local full research uses an isolated PostgreSQL database and a request-scoped repository. The HTTP request remains open until completion; this does not establish safe detached execution or crash resumption. Do not run against the normal pilot database or introduce a background polling loop. Cloud deployment must require a dedicated probe token on every route and expose no Studio surface.

`client.mjs` prepares the isolated database and calls explicit probe endpoints. `/hold` is a no-provider process-interruption probe. `/research-ephemeral` is a remote runtime experiment with request-local evidence only; it is not a production repository or tenant API. Never present its output as remotely persisted.

The operator explicitly authorized retaining `pickler-mastra-runtime-probe` and its Cloudflare secrets on 2026-09-17. Do not automatically delete the deployment or secrets after validation. Retention does not make the ephemeral endpoint a production API.

The database probe recovers expired leases and fails orphan queued requests as `PROBE_REQUEST_INTERRUPTED`, without provider calls. It only then enqueues its new request. Orphan records remain for inspection and still count toward admission quotas. Use the shared lease heartbeat for active research and the hold probe; always close the request repository. `createProbe` accepts a repository factory for lifecycle regression tests; runtime uses the PostgreSQL adapter.

`background/` is a separate local-only Queue experiment with its own instructions, configuration, isolated database and tenant tokens. Unlike the HTTP probe, it preserves queued work and executes research in an awaited Queue consumer. Its more specific instructions govern that lifecycle. Do not apply the probe's orphan-queued cancellation policy to it.

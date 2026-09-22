# Background queue experiment

Read the root, agent-service and parent Cloudflare instructions. This local-only experiment extends the retained HTTP probe without changing its deployment. Use an isolated loopback PostgreSQL database named `pickler_cf_queue_*`.

Reuse the tenant API and research runner. PostgreSQL queued records are the durable pending-work source; Cloudflare Queue messages are wakeups, never tenant authority. Await research in the queue handler, never detach it from an HTTP request. Claim one job with an individual 60-second lease; renew every 15 seconds. Writes and new model/tool operations require current ownership. Preserve queued jobs; interrupted running jobs fail without automatic paid retries. Default capacity is five globally, two per tenant and one per agent, enforced by PostgreSQL. Cron recovers only expired reservations and reconciles pending work and due schedules. Wake another consumer before execution and after completion. Local Cron events must be triggered explicitly in Wrangler.

No paid calls at startup. Do not deploy this configuration or upload database/tenant secrets. Tests may inject execution fixtures, but runtime must use real providers. Always close request-scoped database pools, even if releasing ownership fails.

The local Queue emulator serializes consumer callbacks in the observed validation. Use the `worker` client command to start the updated Node executor against this same isolated database for a reproducible cross-host overlap test. This does not prove remote Cloudflare consumer concurrency. Never alter the normal pilot database for this experiment.

Force `POLYMARKET_TRADING_RUNTIME` to `off` when composing the shared container. This experiment has no signing executor, trading wakeup or wallet secrets. Only the local Node host can opt into the separate trading pilot.

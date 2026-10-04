import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// This checks committed deployment topology. It never contacts providers or exposes secrets.
const read = (path) => {
  const result = ts.parseConfigFileTextToJson(
    path,
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  );
  assert.equal(result.error, undefined, `Invalid JSONC: ${path}`);
  return result.config;
};
const web = read("apps/web/wrangler.jsonc");
const api = read("workers/api/wrangler.staging.jsonc");
const research = read("workers/research/wrangler.jsonc");
const trading = read("workers/trading/wrangler.jsonc");
const requireProvisioned = process.argv.includes("--provisioned");
assert.equal(web.name, "pickler-web-staging");
assert.equal(api.name, "pickler-api-staging");
assert.equal(research.name, "pickler-research-staging");
assert.equal(web.workers_dev, true);
assert.equal(web.services.find((binding) => binding.binding === "API")?.service, api.name);
assert.equal(web.hyperdrive, undefined);
assert.equal(web.durable_objects, undefined);
for (const worker of [api, research]) {
  assert.equal(worker.workers_dev, false);
  assert.equal(worker.preview_urls, false);
  assert.equal(worker.routes, undefined);
  assert.equal(worker.durable_objects, undefined);
  assert.ok(
    ["true", "false"].includes(worker.vars.ADMISSIONS_ENABLED),
    "Set admissions explicitly",
  );
  assert.equal(worker.hyperdrive?.length, 1);
  assert.equal(worker.hyperdrive[0].binding, "DATABASE");
  assert.match(worker.hyperdrive[0].id, /^[a-f0-9]{32}$/);
  assert.equal(worker.vars.ALLOW_INSECURE_STAGING_DATABASE, undefined);
  assert.equal(worker.vars.DATABASE_URL, undefined, "Database credentials must be secrets");
  if (requireProvisioned) {
    assert.match(worker.account_id ?? "", /^[a-f0-9]{32}$/, "Pin the verified Cloudflare account");
  }
  assert.equal(worker.queues.producers[0].queue, "pickler-research-staging");
}
assert.equal(
  api.vars.ADMISSIONS_ENABLED,
  research.vars.ADMISSIONS_ENABLED,
  "Coordinate API and consumer admissions",
);
for (const worker of [api, research]) {
  assert.ok(
    ["true", "false"].includes(worker.vars.PERPL_RUNTIME_ENABLED),
    "Set PERPL_RUNTIME_ENABLED explicitly",
  );
}
assert.equal(
  api.vars.PERPL_RUNTIME_ENABLED,
  research.vars.PERPL_RUNTIME_ENABLED,
  "Coordinate the API's and the research worker's Perpl runtime",
);
assert.equal(api.hyperdrive[0].id, research.hyperdrive[0].id);
assert.equal(research.queues.consumers[0].max_batch_size, 1);
assert.equal(research.queues.consumers[0].max_concurrency, 5);
assert.deepEqual(research.triggers.crons, ["* * * * *"]);
assert.equal(research.limits.cpu_ms, 300000);
if (requireProvisioned) {
  assert.equal(web.account_id, api.account_id);
  assert.equal(research.account_id, api.account_id);
}
console.log(
  requireProvisioned
    ? "Staging topology and identifiers checked; remote secrets and connectivity remain unverified."
    : "Staging topology checked (resource provisioning is not asserted).",
);

assert.equal(trading.name, "pickler-trading-staging");
assert.equal(trading.workers_dev, false);
assert.equal(trading.preview_urls, false);
assert.equal(trading.routes, undefined);
assert.equal(trading.hyperdrive[0].id, api.hyperdrive[0].id);
assert.equal(trading.account_id, api.account_id);
assert.equal(trading.vars.TRADING_ADMISSIONS_ENABLED, api.vars.TRADING_ADMISSIONS_ENABLED);
assert.ok(["true", "false"].includes(trading.vars.TRADING_ADMISSIONS_ENABLED));
assert.equal(
  api.services.find((binding) => binding.binding === "TRADING_EXECUTOR")?.service,
  trading.name,
);
for (const worker of [api, research, trading]) {
  assert.equal(
    worker.queues.producers.find((binding) => binding.binding === "TRADING_QUEUE")?.queue,
    "pickler-trading-queue-staging",
  );
  for (const key of Object.keys(worker.vars)) {
    assert.ok(!/PRIVATE_KEY|CLOB|BUILDER/.test(key), "Trading credentials must be secrets");
  }
}
assert.equal(trading.queues.consumers[0].queue, "pickler-trading-queue-staging");
assert.equal(trading.queues.consumers[0].max_batch_size, 1);
assert.equal(trading.queues.consumers[0].max_concurrency, 1);
assert.deepEqual(trading.triggers.crons, ["* * * * *"]);

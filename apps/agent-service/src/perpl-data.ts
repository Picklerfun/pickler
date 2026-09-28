import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PostgresResearchStore } from "@pickler/infrastructure";
import { PERP_TOOLS, effectivePlugins, PilotError, type PerplConfig } from "@pickler/core";
import { createPerplSession } from "@pickler/agent-runtime/plugins/perpl";
import { capturePerplData } from "./perpl/capture.js";

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      tenant: { type: "string" },
      agent: { type: "string" },
      network: { type: "string" },
      "expected-version": { type: "string" },
      markets: { type: "string" },
      attempt: { type: "string" },
      directory: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "perpl:data configure|check|capture --tenant ID --agent ID\nconfigure: --expected-version N [--network mainnet|testnet] [--markets BTC,ETH]\ncapture: --attempt UNIQUE [--directory PATH]\ncheck/capture use the agent's stored configuration. No models, keys, orders, or migrations.",
    );
    return;
  }
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !["configure", "check", "capture"].includes(action ?? "") ||
    !values.tenant ||
    !values.agent
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Specify configure/check/capture, --tenant and --agent; see --help",
    );
  }
  if (action !== "configure" && (values.network || values.markets || values["expected-version"])) {
    throw new PilotError(
      "INVALID_INPUT",
      "Network and markets are stored configuration; use configure",
    );
  }
  if (action === "capture" && !values.attempt) {
    throw new PilotError("INVALID_INPUT", "Capture requires --attempt");
  }
  if (action !== "capture" && (values.attempt || values.directory)) {
    throw new PilotError("INVALID_INPUT", "Capture options used with another action");
  }
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  const database = process.env.DATABASE_URL;
  if (!database) {
    throw new PilotError("INVALID_INPUT", "DATABASE_URL is required for scoped operator access");
  }
  const repository = new PostgresResearchStore(database);
  const scope = { tenantId: values.tenant, agentId: values.agent };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
  try {
    if (action === "configure") {
      const expected = Number(values["expected-version"]);
      const network = values.network ?? "mainnet";
      const markets = (values.markets ?? "BTC,ETH").split(",");
      if (
        !Number.isSafeInteger(expected) ||
        expected < 1 ||
        !["mainnet", "testnet"].includes(network) ||
        markets.some((s) => s !== "BTC" && s !== "ETH")
      ) {
        throw new PilotError("INVALID_INPUT", "Invalid expected version, network, or markets");
      }
      const current = await repository.agent(scope);
      const perpl = { version: 1, network, markets } as PerplConfig;
      const updated = await repository.updateConfig(scope, expected, {
        ...current.config,
        perpl,
        tools: [...new Set([...current.config.tools, ...PERP_TOOLS])],
        plugins: {
          version: 1,
          enabled: [...new Set([...effectivePlugins(current.config).enabled, "perpl" as const])],
        },
      });
      console.log(
        JSON.stringify(
          {
            scope,
            version: updated.version,
            perpl: updated.config.perpl,
            scheduleEnabled: updated.scheduleEnabled,
          },
          null,
          2,
        ),
      );
    } else if (action === "check") {
      const session = await createPerplSession(repository, scope, signal);
      console.log(JSON.stringify(await session.service.listPerpMarkets(), null, 2));
    } else {
      const result = await capturePerplData({
        repository,
        scope,
        signal,
        root: resolve(values.directory ?? ".data/perpl"),
        attempt: values.attempt!,
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "complete") {
        process.exitCode = 1;
      }
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await repository.close();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof PilotError
      ? `${error.code}: ${error.message}`
      : "PERPL_COMMAND_FAILED: inspect configuration and local storage",
  );
  process.exitCode = 1;
});

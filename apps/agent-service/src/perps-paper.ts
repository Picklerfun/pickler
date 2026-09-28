import { createPerpsPaperRuntime } from "@pickler/agent-runtime/composition/perps-paper";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PostgresResearchStore, PostgresPerpsPaperStore } from "@pickler/infrastructure";
import { effectivePlugins, PilotError } from "@pickler/core";
import { paperRisk } from "@pickler/trading/perps";
import {
  perpsPaperScopeSchema,
  perpsPaperViewSchema,
  perpsPaperIntentSchema,
  perpsPaperRiskSchema,
} from "@pickler/api-schema";
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      tenant: { type: "string" },
      agent: { type: "string" },
      session: { type: "string" },
      network: { type: "string" },
      "expected-version": { type: "string" },
      "enable-plugin": { type: "boolean" },
      symbol: { type: "string" },
      side: { type: "string" },
      kind: { type: "string" },
      key: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "perps:paper account-init|status|risk-check|open|close|tick|report --tenant ID --agent ID --session ID --network mainnet|testnet\naccount-init: --expected-version N [--enable-plugin]\nrisk-check: [--kind open|close --symbol BTC|ETH --side long|short]\nVirtual capital only. Existing agent and matching Perpl config required. Market operations use public GET requests only. No models, migrations, wallet or real orders. --key is required for open/close/tick.",
    );
    return;
  }
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !["account-init", "status", "risk-check", "open", "close", "tick", "report"].includes(
      action ?? "",
    )
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown paper command");
  }
  const scope = perpsPaperScopeSchema.parse({
    tenantId: values.tenant,
    agentId: values.agent,
    sessionId: values.session,
    network: values.network,
  });
  if (action !== "account-init" && (values["enable-plugin"] || values["expected-version"])) {
    throw new PilotError("INVALID_INPUT", "Configuration options require account-init");
  }
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new PilotError("INVALID_INPUT", "DATABASE_URL is required");
  }
  const research = new PostgresResearchStore(process.env.DATABASE_URL);
  const repository = new PostgresPerpsPaperStore(research.pool);
  try {
    if (action === "account-init") {
      let version = Number(values["expected-version"]);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new PilotError("INVALID_INPUT", "Expected version is required");
      }
      if (values["enable-plugin"]) {
        const agent = await research.agent(scope);
        if (agent.version !== version) {
          throw new PilotError("CONFIG_CHANGED", "Agent version differs");
        }
        if (
          agent.config.perpl?.network !== scope.network ||
          !effectivePlugins(agent.config).enabled.includes("perpl")
        ) {
          throw new PilotError(
            "PLUGIN_NOT_CONFIGURED",
            "Enable Perpl on the requested network first",
          );
        }
        const alreadyEnabled =
          effectivePlugins(agent.config).enabled.includes("perps-paper") &&
          agent.config.perpsPaper?.policy === "conservative-1x-v1";
        const updated = alreadyEnabled
          ? agent
          : await research.updateConfig(scope, version, {
              ...agent.config,
              perpsPaper: { version: 1, policy: "conservative-1x-v1" },
              plugins: {
                version: 1,
                enabled: [
                  ...new Set([...effectivePlugins(agent.config).enabled, "perps-paper" as const]),
                ],
              },
            });
        version = updated.version;
      }
      console.log(
        JSON.stringify(
          perpsPaperViewSchema.parse(await repository.initialize(scope, version)),
          null,
          2,
        ),
      );
    } else if (["open", "close", "tick", "report"].includes(action!)) {
      const { service } = createPerpsPaperRuntime(repository, research);
      const signal = AbortSignal.timeout(120000);
      if (action === "report") {
        console.log(JSON.stringify(await service.report(scope), null, 2));
        return;
      }
      if (!values.key) {
        throw new PilotError("INVALID_INPUT", "Mutations require --key");
      }
      if (action === "tick") {
        console.log(JSON.stringify(await service.tick(scope, values.key, signal), null, 2));
        return;
      }
      if (
        (values.symbol !== "BTC" && values.symbol !== "ETH") ||
        (values.side !== "long" && values.side !== "short")
      ) {
        throw new PilotError("INVALID_INPUT", "Use --symbol BTC|ETH --side long|short");
      }
      console.log(
        JSON.stringify(
          await service.trade(
            scope,
            values.key,
            action as "open" | "close",
            values.symbol,
            values.side,
            signal,
          ),
          null,
          2,
        ),
      );
    } else {
      const view = await repository.view(scope);
      if (action === "status") {
        console.log(JSON.stringify(perpsPaperViewSchema.parse(view), null, 2));
      } else {
        const intent =
          values.kind || values.symbol || values.side
            ? perpsPaperIntentSchema.parse({
                kind: values.kind,
                symbol: values.symbol,
                side: values.side,
                notional: values.kind === "close" ? "0" : "100",
                feeReserve: "1",
              })
            : undefined;
        console.log(
          JSON.stringify(
            perpsPaperRiskSchema.parse(paperRisk(view.account, view.attempts, Date.now(), intent)),
            null,
            2,
          ),
        );
      }
    }
  } finally {
    await research.close();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof PilotError
      ? `${error.code}: ${error.message}`
      : "PERPS_PAPER_FAILED: check input and local database",
  );
  process.exitCode = 1;
});

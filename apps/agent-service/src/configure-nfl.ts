import { PostgresResearchStore } from "@pickler/infrastructure";
import { effectivePlugins, type PluginId, type ToolName } from "@pickler/core";
import { readEnv } from "./config/env";
const enableSports = process.argv.includes("--sports");
const env = readEnv();
if (enableSports && (!env.BALLDONTLIE_API_KEY || !env.THE_ODDS_API_KEY)) {
  throw new Error("Configure both optional sports keys before explicitly enabling them");
}
const repository = new PostgresResearchStore(env.DATABASE_URL);
try {
  for (const tenantId of ["alpha", "beta"]) {
    const scope = { tenantId, agentId: `pickle-${tenantId}` };
    const agent = await repository.agent(scope);
    const enabled: PluginId[] = [...effectivePlugins(agent.config).enabled];
    const tools: ToolName[] = [...agent.config.tools];
    if (enableSports) {
      for (const id of ["balldontlie", "the-odds-api"] as const) {
        if (!enabled.includes(id)) {
          enabled.push(id);
        }
      }
      for (const tool of ["getSportsContext", "getExternalOdds"] as const) {
        if (!tools.includes(tool)) {
          tools.push(tool);
        }
      }
    }
    const { marketScope: _scope, ...legacy } = agent.config;
    void _scope;
    const updated = await repository.updateConfig(scope, agent.version, {
      ...legacy,
      categoryIds: agent.config.categoryIds ?? ["450"],
      tools,
      plugins: { version: 1, enabled },
      researchProtocol: "nfl-winner-v1",
      discoveryPolicy: { version: 1, mode: "pre-event", minLeadMinutes: 15, maxHorizonDays: 7 },
    });
    console.log(
      JSON.stringify({
        tenantId,
        agentId: updated.id,
        version: updated.version,
        enabled,
        scheduleEnabled: updated.scheduleEnabled,
      }),
    );
  }
} finally {
  await repository.close();
}

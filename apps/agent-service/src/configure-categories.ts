import { PostgresResearchStore } from "@pickler/infrastructure";
import type { MarketScope } from "@pickler/core";
import { readEnv } from "./config/env";
const repository = new PostgresResearchStore(readEnv().DATABASE_URL);
try {
  for (const tenantId of ["alpha", "beta"] as const) {
    const scope = { tenantId, agentId: `pickle-${tenantId}` };
    const agent = await repository.agent(scope);
    const { categoryIds, researchProtocol, discoveryPolicy, ...config } = agent.config;
    void categoryIds;
    void researchProtocol;
    void discoveryPolicy;
    const marketScope: MarketScope = {
      version: 1,
      category: "sports",
      subcategories: tenantId === "alpha" ? ["american-football"] : ["soccer"],
    };
    const updated = await repository.updateConfig(scope, agent.version, { ...config, marketScope });
    console.log(
      JSON.stringify({
        tenantId,
        agentId: updated.id,
        version: updated.version,
        marketScope,
        scheduleEnabled: updated.scheduleEnabled,
      }),
    );
  }
} finally {
  await repository.close();
}

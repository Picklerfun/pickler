import { createPerpReadService, type AgentRecord, type Scope } from "@pickler/core";
import { PerplMarketData, type PerplDataOptions } from "@pickler/infrastructure";
import { buildPerplTools } from "./tools.js";

/** Fresh, bounded read session. Does not construct a model or require provider credentials. */
export async function createPerplSession(
  repository: { agent(scope: Scope): Promise<AgentRecord> },
  scope: Scope,
  signal: AbortSignal,
  options: PerplDataOptions = {},
) {
  const service = await createPerpReadService({ repository, data: new PerplMarketData(options) })(
    scope,
    signal,
  );
  return { service, tools: buildPerplTools(service) };
}

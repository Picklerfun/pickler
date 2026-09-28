import { createHash } from "node:crypto";
import {
  createPerpsPaperService,
  type PerpsPaperData,
  type AgentRecord,
  type Scope,
  type PerpsPaperRepository,
  assertPerpsPaperAgent,
} from "@pickler/core";
import { createPerplSession } from "./perpl.js";
import type { PerplDataOptions } from "@pickler/infrastructure";
/** Operator-only simulator. No Mastra trading tool or signer is exposed. */
export function createPerpsPaperRuntime(
  repository: PerpsPaperRepository,
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions = {},
) {
  const data: PerpsPaperData = {
    async frame(scope, symbol, signal) {
      const view = await repository.view(scope);
      assertPerpsPaperAgent(await agents.agent(scope), scope, view.account.agentVersion);
      const { service } = await createPerplSession(agents, scope, signal, options);
      const snapshot = await service.getPerpSnapshot({ symbol });
      const book = await service.getPerpOrderBook({ symbol });
      return {
        snapshot,
        book,
        hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
      };
    },
    async observation(scope, from, signal) {
      const view = await repository.view(scope);
      const agent = await agents.agent(scope);
      assertPerpsPaperAgent(agent, scope, view.account.agentVersion);
      const { service } = await createPerplSession(agents, scope, signal, options);
      const frames = [];
      const funding = [];
      for (const symbol of agent.config.perpl!.markets) {
        const snapshot = await service.getPerpSnapshot({ symbol });
        const book = await service.getPerpOrderBook({ symbol });
        frames.push({
          snapshot,
          book,
          hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
        });
        {
          funding.push(
            await service.getPerpFundingHistory({
              symbol,
              from: Math.max(0, from - snapshot.market.fundingIntervalSeconds * 1000),
              to: options.now?.() ?? Date.now(),
            }),
          );
        }
      }
      return { frames, funding };
    },
  };
  return { service: createPerpsPaperService(repository, data, options.now), data };
}

import {
  createResearchRunner,
  DEFAULT_CONFIG,
  type AgentRecord,
  type RunEvent,
  type RunRecord,
} from "@pickler/core";
import { ExaResearch, PolymarketData } from "@pickler/infrastructure";
import { decisionV2Schema } from "@pickler/api-schema";
import { createModel } from "../composition/model";
import type { Environment } from "../config/env";

/** Remote compatibility only: real providers, request-local records, no persistence claim. */
export async function runEphemeralResearch(env: Environment, signal: AbortSignal) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.categoryIds = ["1"];
  const agent: AgentRecord = {
    id: "cloudflare-probe",
    tenantId: "operator-probe",
    version: 1,
    config,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  };
  const run: RunRecord = {
    id: crypto.randomUUID(),
    tenantId: agent.tenantId,
    agentId: agent.id,
    trigger: "manual",
    marketId: null,
    status: "running",
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null,
    configVersion: 1,
    config,
    decision: null,
    error: null,
  };
  const events: RunEvent[] = [];
  const search = new ExaResearch(env.EXA_API_KEY);
  const execute = createResearchRunner({
    repository: {
      async assertOwnership() {},
      async agent() {
        return agent;
      },
      async event(_run, type, data, createdAt) {
        events.push({ id: events.length + 1, type, data, createdAt });
      },
      async finish(_run, decision, error, now) {
        Object.assign(run, {
          decision,
          error,
          finishedAt: now,
          status: error ? "failed" : "completed",
        });
      },
    },
    model: createModel(env),
    search,
    reader: search,
    markets: new PolymarketData(),
  });
  await execute(run, signal);
  if (run.status === "completed") {
    decisionV2Schema.parse(run.decision);
  }
  return { persistence: "none-request-local-probe", run, events };
}

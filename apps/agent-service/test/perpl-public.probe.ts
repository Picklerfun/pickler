/** Explicit public GET acceptance probe; deliberately excluded from automatic *.test.ts discovery. */
import { resolve } from "node:path";
import { DEFAULT_CONFIG, PERP_TOOLS, type AgentRecord, type PerpNetwork } from "@pickler/core";
import { capturePerplData } from "../src/perpl/capture.js";

const network = process.argv[2];
const attempt = process.argv[3];
if ((network !== "mainnet" && network !== "testnet") || !attempt) {
  throw new Error(
    "Usage: node --import tsx apps/agent-service/test/perpl-public.probe.ts mainnet|testnet UNIQUE_ATTEMPT",
  );
}
const record: AgentRecord = {
  id: "public-probe",
  tenantId: "ephemeral-verification",
  version: 1,
  paused: false,
  scheduleEnabled: false,
  nextDueAt: null,
  config: {
    ...structuredClone(DEFAULT_CONFIG),
    tools: [...PERP_TOOLS],
    plugins: { version: 1, enabled: ["perpl"] },
    perpl: { version: 1, network: network as PerpNetwork, markets: ["BTC", "ETH"] },
  },
};
const result = await capturePerplData({
  repository: { agent: async () => structuredClone(record) },
  scope: { tenantId: record.tenantId, agentId: record.id },
  root: resolve("apps/agent-service/.data/perpl-public-probes"),
  attempt,
  signal: AbortSignal.timeout(120_000),
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== "complete") {
  process.exitCode = 1;
}

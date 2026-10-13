/** Generate only controlled, normalized dashboard fixtures. No network or signing. */
import { writeFile } from "node:fs/promises";
import { PerplDashboardGateway } from "../../packages/infrastructure/src/perpl/dashboard.js";
import {
  controlledPerpl,
  DASHBOARD_WALLET,
} from "../../packages/infrastructure/test/perpl-dashboard-fixture.js";

const now = () => Date.parse("2026-10-13T12:00:00.000Z");
const fixture = controlledPerpl(now);
const gateway = new PerplDashboardGateway(fixture.fetcher, now);
const signal = new AbortController().signal;
const proof = { apiKey: "controlled", timestamp: String(now()), signature: "controlled" };
const market = await gateway.markets(signal);
const portfolio = await gateway.portfolio(
  {
    wallet: DASHBOARD_WALLET,
    walletProof: { ...proof, nonce: "wallet-preview" },
    positionsProof: { ...proof, nonce: "positions-preview" },
  },
  signal,
);
await writeFile(
  new URL("../../apps/web/src/features/perpl/preview-data.json", import.meta.url),
  JSON.stringify({ market, portfolio }, null, 2) + "\n",
);
console.log("Generated controlled dashboard preview; no external requests.");

import { Pool } from "pg";
import { PostgresTradingStore } from "../persistence/trading-store.js";
import { databasePoolConfig } from "../persistence/connection.js";

// Explicit operator-only provisioning. No provider calls, approvals or funding.
const [tenantId, agentId, state] = process.argv.slice(2);
if (!tenantId || !agentId || !["bind", "enable", "disable"].includes(state ?? "")) {
  throw new Error("Usage: trading-access <tenantId> <agentId> bind|enable|disable");
}
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}
const pool = new Pool(
  databasePoolConfig(url, {
    environment: process.env.APP_ENV ?? "staging",
    ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : {}),
  }),
);
try {
  const store = new PostgresTradingStore(pool);
  const scope = { tenantId, agentId };
  if (state === "bind") {
    const wallet = process.env.POLYMARKET_WALLET_ADDRESS;
    const signer = process.env.POLYMARKET_SIGNER_ADDRESS;
    if (!wallet || !signer) {
      throw new Error("Public wallet and signer addresses required");
    }
    await store.bind(scope, { wallet, signer });
  } else {
    await store.setEnabled(scope, state === "enable");
  }
  console.log(JSON.stringify(await store.account(scope)));
} catch {
  console.error(
    "Trading access update failed. Check identity, binding and database configuration.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

import { resolve } from "node:path";
import { setupTradingAccount } from "@pickler/infrastructure/trading-operator";
import { PostgresResearchStore, PostgresTradingStore } from "@pickler/infrastructure";
import { readEnv } from "./config/env";
const env = readEnv();
try {
  for (const value of [
    env.POLYMARKET_SIGNER_PRIVATE_KEY,
    env.POLYMARKET_SIGNER_ADDRESS,
    env.POLYMARKET_BUILDER_API_KEY,
    env.POLYMARKET_BUILDER_SECRET,
    env.POLYMARKET_BUILDER_PASSPHRASE,
  ]) {
    if (!value) {
      throw new Error("Missing operator credentials");
    }
  }
  const identity = await setupTradingAccount({
    path: resolve(process.cwd(), ".env"),
    approve: process.argv.includes("--approvals"),
    privateKey: env.POLYMARKET_SIGNER_PRIVATE_KEY!,
    signer: env.POLYMARKET_SIGNER_ADDRESS!,
    builderKey: env.POLYMARKET_BUILDER_API_KEY!,
    builderSecret: env.POLYMARKET_BUILDER_SECRET!,
    builderPassphrase: env.POLYMARKET_BUILDER_PASSPHRASE!,
    ...(env.POLYMARKET_WALLET_ADDRESS ? { wallet: env.POLYMARKET_WALLET_ADDRESS } : {}),
  });
  const research = new PostgresResearchStore(env.DATABASE_URL);
  try {
    await new PostgresTradingStore(research.pool).bind(
      { tenantId: "alpha", agentId: "pickle-alpha" },
      identity,
    );
  } finally {
    await research.close();
  }
  console.log(JSON.stringify(identity));
} catch {
  console.error(
    "Trading setup incomplete. Verify operator credentials and deployment state before explicitly retrying; No funding or trading was requested; approvals are requested only with --approvals.",
  );
  process.exitCode = 1;
}

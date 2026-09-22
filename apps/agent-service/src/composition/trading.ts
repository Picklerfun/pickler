import { createTradingService, PilotError } from "@pickler/core";
import {
  PolymarketTrading,
  PostgresTradingStore,
  type PostgresResearchStore,
} from "@pickler/infrastructure";
import type { Environment } from "../config/env";
export function composeTrading(env: Environment, research: PostgresResearchStore) {
  if (env.POLYMARKET_TRADING_RUNTIME !== "node") {
    return undefined;
  }
  const fields = [
    env.POLYMARKET_SIGNER_PRIVATE_KEY,
    env.POLYMARKET_SIGNER_ADDRESS,
    env.POLYMARKET_WALLET_ADDRESS,
    env.POLYMARKET_CLOB_API_KEY,
    env.POLYMARKET_CLOB_API_SECRET,
    env.POLYMARKET_CLOB_API_PASSPHRASE,
  ];
  if (fields.some((v) => !v)) {
    throw new PilotError(
      "TRADING_NOT_CONFIGURED",
      "Configure all operator trading credentials before enabling the Node runtime",
    );
  }
  return createTradingService(
    new PostgresTradingStore(research.pool),
    new PolymarketTrading({
      privateKey: env.POLYMARKET_SIGNER_PRIVATE_KEY!,
      signer: env.POLYMARKET_SIGNER_ADDRESS!,
      wallet: env.POLYMARKET_WALLET_ADDRESS!,
      apiKey: env.POLYMARKET_CLOB_API_KEY!,
      secret: env.POLYMARKET_CLOB_API_SECRET!,
      passphrase: env.POLYMARKET_CLOB_API_PASSPHRASE!,
    }),
  );
}

import { createPublicTokenTrading } from "@pickler/core";
import {
  createJsonRpc,
  createPublicTokenTradeDriver,
  parseTokenLaunchPolicy,
  reservePublicTokenRpc,
  type TokenLaunchDatabase,
} from "@pickler/infrastructure";
import type { Env } from "./env";
import type { createGrowthServices } from "./growth/services";
export function composePublicTokenTrading(
  pool: TokenLaunchDatabase,
  env: Env,
  growth: ReturnType<typeof createGrowthServices>,
) {
  const enabled = env.TOKEN_PUBLIC_TRADING_ENABLED === "true";
  const limit = Number(env.TOKEN_PUBLIC_RPC_DAILY_LIMIT);
  if (
    enabled &&
    (!env.TOKEN_LAUNCH_POLICY_JSON ||
      !env.MONAD_RPC_URL ||
      !Number.isSafeInteger(limit) ||
      limit < 40 ||
      limit > 100_000)
  ) {
    throw new Error("Public token trading configuration incomplete");
  }
  return createPublicTokenTrading({
    enabled,
    token: async (handle) => {
      const persona = await growth.getAgentPersona(handle);
      const token = persona?.launchedToken;
      return persona && token
        ? { agentId: persona.id, token: token.address, chainId: token.chainId }
        : null;
    },
    ...(enabled
      ? {
          driver: createPublicTokenTradeDriver({
            policy: parseTokenLaunchPolicy(env.TOKEN_LAUNCH_POLICY_JSON!),
            rpc: createJsonRpc(env.MONAD_RPC_URL!),
            reserve: (wallet) => reservePublicTokenRpc(pool, wallet, limit),
          }),
        }
      : {}),
  });
}

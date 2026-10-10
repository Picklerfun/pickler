import type { TokenLaunchDatabase } from "@pickler/infrastructure";
import { AUSD } from "@pickler/chain";
import {
  createTokenLaunchService,
  createTokenOperationService,
  tokenReferenceEconomics,
} from "@pickler/core";
import {
  PostgresTokenLaunchStore,
  createPlatformTokenIssuer,
  createTokenMetadata,
  createTokenOperationDriver,
  createActivityBuilders,
  createTurnkeyActivityForwarder,
  createTurnkeyReader,
  parseTokenLaunchPolicy,
} from "@pickler/infrastructure";
import type { Env } from "./env";
import { createJsonRpc } from "@pickler/infrastructure";
/** No launch/RPC/provider side effect at composition. An incomplete configuration fails closed. */
export function composeTokenLauncher(pool: TokenLaunchDatabase, env: Env, chainId: number | null) {
  let repository = new PostgresTokenLaunchStore(pool);
  let issuer;
  let driver;
  if (env.TOKEN_LAUNCH_ENABLED === "true") {
    if (
      chainId !== 10143 ||
      !env.TOKEN_LAUNCH_POLICY_JSON ||
      !env.TOKEN_LAUNCH_AUTHORITY_KEY ||
      !env.TOKEN_METADATA ||
      !env.MONAD_RPC_URL ||
      !env.TURNKEY_API_PUBLIC_KEY ||
      !env.TURNKEY_API_PRIVATE_KEY ||
      env.TURNKEY_RPID !== "app.pickler.fun"
    ) {
      throw new Error("Token launcher configuration incomplete");
    }
    const policy = parseTokenLaunchPolicy(env.TOKEN_LAUNCH_POLICY_JSON);
    repository = new PostgresTokenLaunchStore(
      pool,
      policy.escrow.address,
      policy.preset.quoteAddress,
    );
    const reader = createTurnkeyReader({
      apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
      apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
    });
    driver = createTokenOperationDriver({
      policy,
      rpc: createJsonRpc(env.MONAD_RPC_URL),
      reader,
      forwarder: createTurnkeyActivityForwarder({ reader, pollAttempts: 0 }),
      activities: createActivityBuilders(),
      organization: async (scope) => {
        const result = await pool.query<{ organizationId: string }>(
          `SELECT sub_organization_id AS "organizationId" FROM wallets.turnkey_orgs WHERE user_id=$1`,
          [scope.userId],
        );
        if (result.rows.length !== 1) {
          throw new Error("MASTER_ORGANIZATION_REQUIRED");
        }
        return result.rows[0]!.organizationId;
      },
      reserveRpc: async (id, limit) => {
        const r = await pool.query(
          "UPDATE launch.operations SET rpc_calls=rpc_calls+1 WHERE id=$1 AND rpc_calls<$2 RETURNING id",
          [id, limit],
        );
        if (r.rowCount !== 1) {
          throw new Error("TOKEN_RPC_BUDGET_EXHAUSTED");
        }
      },
    });
    issuer = createPlatformTokenIssuer(
      policy,
      env.TOKEN_LAUNCH_AUTHORITY_KEY,
      createTokenMetadata(env.TOKEN_METADATA, policy.metadataOrigin),
      driver.checkReadiness!,
    );
  }
  const tokens = createTokenLaunchService({
    repository,
    chainId,
    ...(issuer ? { issuer } : {}),
    ...(chainId === 143 || chainId === 10143
      ? { referenceEconomics: tokenReferenceEconomics(AUSD[chainId]) }
      : {}),
  });
  return {
    tokens,
    tokenOperations: createTokenOperationService({
      repository,
      tokens,
      chainId,
      ...(driver ? { driver } : {}),
    }),
  };
}

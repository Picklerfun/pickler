import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  toHex,
  type Abi,
  type Hex,
} from "viem";
import { PicklerLaunchFactoryAbi, PicklerBondingCurveAbi } from "@pickler/chain";
import {
  PublicTokenTradeError,
  TokenTradeError,
  tokenTradeMinimumOutput,
  type PublicTokenTradeDriver,
} from "@pickler/core";
import type { TokenLaunchPolicy } from "./policy.js";
import type { Rpc } from "../chain/erc20.js";
import { pendingNonce, quoteFees } from "../chain/deposit-tx.js";
import { tokenAgentKey } from "../studio/token-launch-store.js";
import type { Pool } from "pg";

/** Global RPC ceiling, reserved before transport; failed preparations consume their reservation. */
export async function reservePublicTokenRpc(pool: Pool, wallet: string, dailyLimit: number) {
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 40) {
    throw new PublicTokenTradeError("RPC_LIMIT");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const budget = await client.query(
      `INSERT INTO pickler.provider_quotas (key,window_start,used)
      VALUES ('public-token-rpc',date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')::text,40)
      ON CONFLICT (key,window_start) DO UPDATE SET used=provider_quotas.used+40
      WHERE provider_quotas.used+40 <= $1 RETURNING used`,
      [dailyLimit],
    );
    const throttle = await client.query(
      `INSERT INTO pickler.provider_quotas (key,window_start,used)
      VALUES ($1,date_trunc('minute',clock_timestamp() AT TIME ZONE 'UTC')::text,1)
      ON CONFLICT (key,window_start) DO UPDATE SET used=provider_quotas.used+1
      WHERE provider_quotas.used < 6 RETURNING used`,
      ["public-token-wallet:" + wallet.toLowerCase()],
    );
    if (budget.rowCount !== 1 || throttle.rowCount !== 1) {
      throw new PublicTokenTradeError("RPC_LIMIT");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
/** Resolves contracts from a canonical published token and reviewed deployment, never browser targets. */
export function createPublicTokenTradeDriver(deps: {
  policy: TokenLaunchPolicy;
  rpc: Rpc;
  reserve(wallet: string): Promise<void>;
  now?: () => number;
}): PublicTokenTradeDriver {
  const policy = deps.policy;
  return {
    async prepare(context, input) {
      await deps.reserve(input.wallet);
      let calls = 0;
      const rpc: Rpc = {
        call(method, params) {
          if (++calls > 40) {
            throw new PublicTokenTradeError("RPC_LIMIT");
          }
          return deps.rpc.call(method, params);
        },
      };
      if (BigInt(String(await rpc.call("eth_chainId", []))) !== 10143n) {
        throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
      }
      const block = await rpc.call("eth_blockNumber", []);
      if (typeof block !== "string" || !/^0x[0-9a-f]+$/i.test(block)) {
        throw new PublicTokenTradeError("PROVIDER_UNAVAILABLE");
      }
      async function read(
        address: string,
        abi: readonly unknown[],
        name: string,
        args: unknown[] = [],
      ) {
        const data = encodeFunctionData({ abi: abi as Abi, functionName: name, args });
        const result = await rpc.call("eth_call", [{ to: address, data }, block]);
        if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
          throw new PublicTokenTradeError("PROVIDER_UNAVAILABLE");
        }
        return decodeFunctionResult({ abi: abi as Abi, functionName: name, data: result as Hex });
      }
      for (const deployment of [
        policy.factory,
        policy.deployer,
        ...(policy.venue === "uniswap_v4" ? [policy.quote] : []),
      ]) {
        const code = await rpc.call("eth_getCode", [deployment.address, block]);
        if (
          typeof code !== "string" ||
          code === "0x" ||
          keccak256(code as Hex) !== deployment.codeHash
        ) {
          throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
        }
        if (deployment.implementation) {
          const impl = deployment.implementation;
          const slot = await rpc.call("eth_getStorageAt", [deployment.address, impl.slot, block]);
          const bytecode = await rpc.call("eth_getCode", [impl.address, block]);
          if (
            typeof slot !== "string" ||
            slot.toLowerCase().slice(-40) !== impl.address.slice(2) ||
            typeof bytecode !== "string" ||
            keccak256(bytecode as Hex) !== impl.codeHash
          ) {
            throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
          }
        }
      }
      const launch = (await read(policy.factory.address, PicklerLaunchFactoryAbi, "getLaunch", [
        context.token,
      ])) as {
        token: string;
        curve: Hex;
        agentKey: string;
        quoteToken: string;
        presetHash: string;
      };
      if (
        context.chainId !== 10143 ||
        launch.agentKey !== tokenAgentKey(10143, context.agentId) ||
        launch.token.toLowerCase() !== context.token.toLowerCase() ||
        launch.quoteToken.toLowerCase() !== policy.preset.quoteAddress ||
        launch.presetHash !== policy.preset.configHash ||
        /^0x0+$/.test(launch.curve)
      ) {
        throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
      }
      const [token, quoteToken, deployer, phase] = await Promise.all([
        read(launch.curve, PicklerBondingCurveAbi, "token"),
        read(launch.curve, PicklerBondingCurveAbi, "quoteToken"),
        read(launch.curve, PicklerBondingCurveAbi, "deployer"),
        read(launch.curve, PicklerBondingCurveAbi, "phase"),
      ]);
      const [tokenDecimals, quoteDecimals] = await Promise.all([
        read(context.token, erc20Abi, "decimals"),
        read(launch.quoteToken, erc20Abi, "decimals"),
      ]);
      if (
        String(token).toLowerCase() !== context.token.toLowerCase() ||
        String(quoteToken).toLowerCase() !== policy.preset.quoteAddress ||
        String(deployer).toLowerCase() !== policy.deployer.address ||
        tokenDecimals !== 18 ||
        quoteDecimals !== 6
      ) {
        throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
      }
      if (phase !== 0) {
        throw new TokenTradeError("CURVE_CLOSED");
      }
      const buying = input.side === "buy";
      const amount = BigInt(input.amount);
      const asset = buying ? launch.quoteToken : context.token;
      const [balance, allowance, output, remaining] = (await Promise.all([
        read(asset, erc20Abi, "balanceOf", [input.wallet]),
        read(asset, erc20Abi, "allowance", [input.wallet, launch.curve]),
        read(launch.curve, PicklerBondingCurveAbi, buying ? "quoteBuy" : "quoteSell", [amount]),
        read(launch.curve, PicklerBondingCurveAbi, "remainingTokens"),
      ])) as bigint[];
      if (balance! < amount) {
        throw new TokenTradeError("INSUFFICIENT_TOKEN_BALANCE");
      }
      if (output! <= 0n) {
        throw new TokenTradeError("TRADE_TOO_SMALL");
      }
      if (buying && output! > remaining!) {
        throw new TokenTradeError("EXCEEDS_CURVE_INVENTORY");
      }
      const minimum = tokenTradeMinimumOutput(output!, input.slippageBps);
      const approval = allowance! < amount;
      const expires = Math.floor((deps.now?.() ?? Date.now()) / 1000) + 300;
      const data = approval
        ? encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [launch.curve, amount],
          })
        : encodeFunctionData({
            abi: PicklerBondingCurveAbi,
            functionName: buying ? "buyExactInput" : "sellExactInput",
            args: [amount, minimum, input.wallet as Hex, BigInt(expires)],
          });
      const to = approval ? asset : launch.curve;
      const base = { from: input.wallet, to, data, value: "0x0" as const };
      const [nonce, fees] = await Promise.all([pendingNonce(rpc, input.wallet), quoteFees(rpc)]);
      const [estimated, native] = await Promise.all([
        rpc.call("eth_estimateGas", [base]),
        rpc.call("eth_getBalance", [input.wallet, "latest"]),
      ]);
      const gas = (BigInt(String(estimated)) * 120n + 99n) / 100n;
      const cost = gas * fees.maxFeePerGas;
      if (
        !Number.isSafeInteger(nonce) ||
        nonce < 0 ||
        gas <= 0n ||
        gas > BigInt(policy.maxGas) ||
        fees.maxFeePerGas > BigInt(policy.maxFeePerGas) ||
        cost > BigInt(policy.maxGasCost)
      ) {
        throw new PublicTokenTradeError("TRADING_UNAVAILABLE");
      }
      if (BigInt(String(native)) < cost) {
        throw new PublicTokenTradeError("INSUFFICIENT_GAS");
      }
      return {
        version: 1,
        token: context.token,
        curve: launch.curve,
        quoteToken: launch.quoteToken,
        expiresAt: new Date(expires * 1000).toISOString(),
        quote: {
          amount: input.amount,
          slippageBps: input.slippageBps,
          side: input.side,
          approval,
          expectedOutput: output!.toString(),
          minimumOutput: minimum.toString(),
          balance: balance!.toString(),
          allowance: allowance!.toString(),
          feeBps: buying ? policy.preset.buyFeeBps : policy.preset.sellFeeBps,
        },
        transaction: {
          ...base,
          chainId: 10143,
          nonce,
          gas: toHex(gas),
          maxFeePerGas: toHex(fees.maxFeePerGas),
          maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas),
        },
      };
    },
  };
}

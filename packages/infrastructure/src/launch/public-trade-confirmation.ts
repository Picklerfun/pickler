import type { Pool } from "pg";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  type Abi,
  type Hex,
} from "viem";
import { PicklerBondingCurveAbi, PicklerLaunchFactoryAbi } from "@pickler/chain";
import {
  PublicTokenTradeError,
  type ChainLog,
  type PublicTokenTradeConfirmation,
  type PublicTokenTradeContext,
} from "@pickler/core";
import type { Rpc } from "../chain/erc20.js";
import { decodeLaunchLog } from "../chain/launch-log-decoder.js";
import { tokenAgentKey } from "../studio/token-launch-store.js";
import type { TokenLaunchPolicy } from "./policy.js";

const hash = /^0x[0-9a-f]{64}$/i;
const quantity = /^0x[0-9a-f]+$/i;
const lower = (value: string) => value.toLowerCase();
type Header = { hash: string; number: string; parentHash: string; timestamp: string };
type Receipt = {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  status: string;
  logs: Array<{
    address: string;
    topics: Hex[];
    data: Hex;
    logIndex: string;
    blockNumber: string;
    blockHash: string;
    transactionHash: string;
    removed?: boolean;
  }>;
};

/** Append one verified receipt. Never rewrite history, resolve reorgs, or advance a cursor. */
export function createPublicTradeConfirmation(deps: {
  pool: Pool;
  policy: TokenLaunchPolicy;
  rpc: Rpc;
  reserve(wallet: string): Promise<void>;
}) {
  return async (
    context: PublicTokenTradeContext,
    input: PublicTokenTradeConfirmation,
  ): Promise<{ status: "pending" | "confirmed" | "reverted" }> => {
    const chain = "eip155:10143";
    const txHash = lower(input.txHash);
    const token = lower(context.token);
    const wallet = lower(input.wallet);
    const existing = await deps.pool.query(
      `SELECT 1 FROM market.chain_events e
       JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
       JOIN market.pools p ON p.address=e.emitter
       JOIN market.tokens t ON t.id=p.token_id AND t.chain=e.chain
       WHERE t.chain=$1 AND t.address=$2 AND t.agent_id=$3 AND e.tx_hash=$4
         AND e.event_name IN ('CurveBought','CurveSold')
         AND lower(coalesce(e.decoded->>'recipient',e.decoded->>'seller'))=$5
         AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')`,
      [chain, token, context.agentId, txHash, wallet],
    );
    if (existing.rowCount) {
      return { status: "confirmed" };
    }
    await deps.reserve(wallet);
    let calls = 0;
    const rpc: Rpc = {
      call(method, params) {
        if (++calls > 40) {
          throw new PublicTokenTradeError("RPC_LIMIT");
        }
        return deps.rpc.call(method, params);
      },
    };
    if (
      context.chainId !== 10143 ||
      BigInt(String(await rpc.call("eth_chainId", []))) !== 10143n ||
      deps.policy.factory.implementation
    ) {
      throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
    }
    const receipt = (await rpc.call("eth_getTransactionReceipt", [txHash])) as Receipt | null;
    if (!receipt) {
      return { status: "pending" };
    }
    if (
      !hash.test(receipt.blockHash) ||
      !quantity.test(receipt.blockNumber) ||
      lower(receipt.transactionHash) !== txHash ||
      !["0x0", "0x1"].includes(receipt.status) ||
      !Array.isArray(receipt.logs)
    ) {
      throw new PublicTokenTradeError("INVALID_TRADE");
    }
    const number = BigInt(receipt.blockNumber);
    if (
      number > BigInt(Number.MAX_SAFE_INTEGER) ||
      number < BigInt(deps.policy.factory.deploymentBlock)
    ) {
      throw new PublicTokenTradeError("INVALID_TRADE");
    }
    const tip = BigInt(String(await rpc.call("eth_blockNumber", [])));
    async function header() {
      const block = (await rpc.call("eth_getBlockByNumber", [
        receipt!.blockNumber,
        false,
      ])) as Header | null;
      if (
        !block ||
        !hash.test(block.hash) ||
        !hash.test(block.parentHash) ||
        !quantity.test(block.number) ||
        BigInt(block.number) !== number ||
        lower(block.hash) !== lower(receipt!.blockHash) ||
        !quantity.test(block.timestamp)
      ) {
        throw new PublicTokenTradeError("PROVIDER_UNAVAILABLE");
      }
      return block;
    }
    const block = await header();
    if (tip < number + BigInt(deps.policy.confirmations)) {
      return { status: "pending" };
    }
    async function read(address: string, abi: Abi, functionName: string, args: unknown[] = []) {
      const data = encodeFunctionData({ abi, functionName, args });
      const result = await rpc.call("eth_call", [{ to: address, data }, receipt!.blockNumber]);
      return decodeFunctionResult({ abi, functionName, data: result as Hex });
    }
    const code = await rpc.call("eth_getCode", [deps.policy.factory.address, receipt.blockNumber]);
    if (typeof code !== "string" || keccak256(code as Hex) !== deps.policy.factory.codeHash) {
      throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
    }
    const launch = (await read(deps.policy.factory.address, PicklerLaunchFactoryAbi, "getLaunch", [
      token,
    ])) as {
      token: string;
      curve: string;
      agentKey: string;
      quoteToken: string;
      presetHash: string;
    };
    if (
      lower(launch.token) !== token ||
      lower(launch.agentKey) !== tokenAgentKey(10143, context.agentId) ||
      lower(launch.quoteToken) !== deps.policy.preset.quoteAddress ||
      lower(launch.presetHash) !== deps.policy.preset.configHash ||
      !/^0x[0-9a-f]{40}$/i.test(launch.curve) ||
      /^0x0+$/.test(launch.curve)
    ) {
      throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
    }
    const curve = lower(launch.curve);
    const tx = (await rpc.call("eth_getTransactionByHash", [txHash])) as {
      hash: string;
      from: string;
      to: string;
      input: Hex;
      value: string;
      blockHash: string;
      blockNumber: string;
    } | null;
    if (
      !tx ||
      lower(tx.hash) !== txHash ||
      lower(tx.from) !== wallet ||
      lower(tx.to) !== curve ||
      lower(tx.blockHash) !== lower(block.hash) ||
      BigInt(tx.blockNumber) !== number ||
      BigInt(tx.value) !== 0n
    ) {
      throw new PublicTokenTradeError("INVALID_TRADE");
    }
    const call = decodeFunctionData({ abi: PicklerBondingCurveAbi, data: tx.input });
    const args = call.args as readonly unknown[];
    const buying = call.functionName === "buyExactInput";
    if (
      (!buying && call.functionName !== "sellExactInput") ||
      String(args[2]).toLowerCase() !== wallet ||
      typeof args[0] !== "bigint" ||
      args[0] <= 0n
    ) {
      throw new PublicTokenTradeError("INVALID_TRADE");
    }
    if (receipt.status === "0x0") {
      return { status: "reverted" };
    }
    const [boundToken, boundQuote, boundDeployer] = await Promise.all([
      read(curve, PicklerBondingCurveAbi, "token"),
      read(curve, PicklerBondingCurveAbi, "quoteToken"),
      read(curve, PicklerBondingCurveAbi, "deployer"),
    ]);
    if (
      lower(String(boundToken)) !== token ||
      lower(String(boundQuote)) !== deps.policy.preset.quoteAddress ||
      lower(String(boundDeployer)) !== deps.policy.deployer.address
    ) {
      throw new PublicTokenTradeError("DEPLOYMENT_CHANGED");
    }
    const events = receipt.logs
      .filter((log) => lower(log.address) === curve)
      .map((log) => {
        if (
          log.removed ||
          lower(log.blockHash) !== lower(block.hash) ||
          BigInt(log.blockNumber) !== number ||
          lower(log.transactionHash) !== txHash ||
          !quantity.test(log.logIndex)
        ) {
          throw new PublicTokenTradeError("INVALID_TRADE");
        }
        const index = BigInt(log.logIndex);
        if (index > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new PublicTokenTradeError("INVALID_TRADE");
        }
        const event: ChainLog = {
          chainId: 10143,
          removed: false,
          address: curve as Hex,
          blockNumber: number,
          blockHash: lower(block.hash) as Hex,
          transactionHash: txHash as Hex,
          logIndex: Number(index),
          topics: log.topics,
          data: log.data,
        };
        const decoded = decodeLaunchLog(event);
        if (
          !decoded ||
          !["CurveBought", "CurveSold", "CurveCompleted"].includes(decoded.eventName)
        ) {
          throw new PublicTokenTradeError("INVALID_TRADE");
        }
        return { log: event, decoded };
      });
    const trades = events.filter((event) =>
      ["CurveBought", "CurveSold"].includes(event.decoded.eventName),
    );
    if (
      trades.length !== 1 ||
      new Set(events.map((event) => event.log.logIndex)).size !== events.length
    ) {
      throw new PublicTokenTradeError("INVALID_TRADE");
    }
    const trade = trades[0]!;
    const d = trade.decoded.decoded as Record<string, string>;
    if (
      trade.decoded.eventName !== (buying ? "CurveBought" : "CurveSold") ||
      lower(d[buying ? "recipient" : "seller"] ?? "") !== wallet ||
      lower(d.recipient ?? "") !== wallet ||
      BigInt(d[buying ? "grossQuoteIn" : "tokensIn"] ?? "0") !== args[0] ||
      BigInt(d[buying ? "tokensOut" : "netQuoteOut"] ?? "0") < (args[1] as bigint)
    ) {
      throw new PublicTokenTradeError("INVALID_TRADE");
    }
    const stable = await header();
    if (stable.parentHash !== block.parentHash || stable.timestamp !== block.timestamp) {
      throw new PublicTokenTradeError("PROVIDER_UNAVAILABLE");
    }
    const client = await deps.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "market:" + chain,
      ]);
      const canonical = await client.query(
        `SELECT 1 FROM market.tokens t
         JOIN market.chain_events e ON e.chain=t.chain AND e.tx_hash=t.launch_tx_hash AND e.event_name='LaunchCreated'
         JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
         WHERE t.chain=$1 AND t.address=$2 AND t.agent_id=$3 AND t.status IN ('pre_graduation','graduated')
           AND e.emitter=$4 AND lower(e.decoded->>'curve')=$5 AND NOT e.orphaned AND NOT b.orphaned
           AND b.finality IN ('confirmed','finalized') AND e.block_number<=$6 FOR SHARE OF t,e,b`,
        [chain, token, context.agentId, deps.policy.factory.address, curve, Number(number)],
      );
      if (!canonical.rowCount) {
        throw new PublicTokenTradeError("TOKEN_NOT_FOUND");
      }
      const conflict = await client.query(
        `SELECT 1 FROM market.chain_blocks WHERE chain=$1 AND
          ((number=$2 AND hash<>$3 AND NOT orphaned) OR
           (hash=$3 AND (orphaned OR finality NOT IN ('confirmed','finalized') OR number<>$2 OR parent_hash<>$4 OR block_time<>to_timestamp($5))))
         UNION ALL SELECT 1 FROM market.chain_events WHERE chain=$1 AND tx_hash=$6 AND
          ((block_hash<>$3 AND NOT orphaned) OR (block_hash=$3 AND orphaned))`,
        [
          chain,
          Number(number),
          lower(block.hash),
          lower(block.parentHash),
          Number(BigInt(block.timestamp)),
          txHash,
        ],
      );
      if (conflict.rowCount) {
        // Conflicting or orphaned history is the indexer's responsibility, never a public request's.
        await client.query("ROLLBACK");
        return { status: "pending" };
      }
      await client.query(
        `INSERT INTO market.chain_blocks(chain,hash,number,parent_hash,block_time,finality)
         VALUES($1,$2,$3,$4,to_timestamp($5),'confirmed') ON CONFLICT(chain,hash) DO NOTHING`,
        [
          chain,
          lower(block.hash),
          Number(number),
          lower(block.parentHash),
          Number(BigInt(block.timestamp)),
        ],
      );
      for (const event of events) {
        const stored = await client.query(
          `SELECT 1 FROM market.chain_events WHERE chain=$1 AND block_hash=$2 AND tx_hash=$3 AND log_index=$4
           AND (emitter<>$5 OR event_name<>$6 OR topics<>$7::jsonb OR data<>$8 OR block_number<>$9)`,
          [
            chain,
            event.log.blockHash,
            txHash,
            event.log.logIndex,
            curve,
            event.decoded.eventName,
            JSON.stringify(event.log.topics),
            event.log.data,
            Number(number),
          ],
        );
        if (stored.rowCount) {
          await client.query("ROLLBACK");
          return { status: "pending" };
        }
        await client.query(
          `INSERT INTO market.chain_events(chain,block_hash,tx_hash,log_index,block_number,emitter,event_name,abi_hash,topics,data,decoded)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(chain,block_hash,tx_hash,log_index) DO NOTHING`,
          [
            chain,
            event.log.blockHash,
            txHash,
            event.log.logIndex,
            Number(number),
            curve,
            event.decoded.eventName,
            event.decoded.abiHash,
            JSON.stringify(event.log.topics),
            event.log.data,
            event.decoded.decoded,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { status: "confirmed" };
  };
}

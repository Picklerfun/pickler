import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decodeFunctionResult, encodeFunctionData, keccak256, type Abi, type Hex } from "viem";
import {
  IUniswapV4ReadAbi,
  PicklerLiquidityLockerV2Abi,
  IKuruAccountCoreAbi,
  IKuruOrderBookAbi,
  PicklerKuruPositionVaultAbi,
  PicklerGraduationAdapterKuruAbi,
} from "@pickler/chain";
import type { BlockRef, ChainReader, ChainLog } from "@pickler/core";
import type { Rpc } from "../chain/erc20.js";
import { decodeLaunchLog } from "../chain/launch-log-decoder.js";
import { runIndexerPass } from "../chain/launch-indexer.js";
import { PostgresLaunchIndexStore } from "../persistence/product/launch-index-store.js";
import { PostgresLaunchProjector } from "../persistence/product/launch-projector.js";
import { encodeAbiParameters } from "viem";
import { PostgresUniswapProjector } from "./uniswap-projector.js";
import { PostgresKuruProjector } from "./kuru-projector.js";
import { parseTokenLaunchPolicy } from "./policy.js";
const legacyTokenIndexerPolicySchema = z
  .object({
    version: z.literal(1),
    maxBlocks: z.literal(100),
    rpcRequestsPerPass: z.number().int().min(400).max(10000),
    rpcRequestsPerDay: z.number().int().positive(),
    leaseSeconds: z.number().int().min(30).max(300),
    maxCurvesPerPass: z.number().int().min(1).max(100),
  })
  .strict();
/** Version 1 retains one pass per Cron; version 2 explicitly budgets bounded catch-up. */
export const tokenIndexerPolicySchema = z.discriminatedUnion("version", [
  legacyTokenIndexerPolicySchema,
  legacyTokenIndexerPolicySchema.extend({
    version: z.literal(2),
    maxPassesPerTick: z.number().int().min(1).max(6),
  }),
]);
const blockTag = (n: bigint) => `0x${n.toString(16)}`;
function block(v: unknown): BlockRef {
  const b = v as Record<string, string> | null;
  if (
    !b ||
    !/^0x[0-9a-f]{64}$/i.test(b.hash ?? "") ||
    !/^0x[0-9a-f]{64}$/i.test(b.parentHash ?? "") ||
    !/^0x[0-9a-f]+$/i.test(b.number ?? "") ||
    !/^0x[0-9a-f]+$/i.test(b.timestamp ?? "")
  ) {
    throw new Error("INVALID_INDEX_BLOCK");
  }
  return {
    number: BigInt(b.number!),
    hash: b.hash!.toLowerCase() as Hex,
    parentHash: b.parentHash!.toLowerCase() as Hex,
    timestamp: BigInt(b.timestamp!),
  };
}
/** Single transport, no retry/fallback. Every call is reserved before transport. */
export function tokenChainReader(rpc: Rpc): ChainReader {
  return {
    chainId: 10143,
    async getLatestBlock() {
      return block(await rpc.call("eth_getBlockByNumber", ["latest", false]));
    },
    async getBlock(n) {
      const b = block(await rpc.call("eth_getBlockByNumber", [blockTag(n), false]));
      if (b.number !== n) {
        throw new Error("INDEX_BLOCK_MISMATCH");
      }
      return b;
    },
    async call(q) {
      const result = await rpc.call("eth_call", [
        { to: q.to, data: q.data },
        q.blockNumber === undefined ? "latest" : blockTag(q.blockNumber),
      ]);
      if (typeof result !== "string" || !/^0x[0-9a-f]*$/i.test(result)) {
        throw new Error("INVALID_INDEX_READ");
      }
      return result as Hex;
    },
    async getLogs(q) {
      const result = await rpc.call("eth_getLogs", [
        {
          fromBlock: blockTag(q.fromBlock),
          toBlock: blockTag(q.toBlock),
          address: q.addresses,
          topics: q.topics,
        },
      ]);
      if (!Array.isArray(result)) {
        throw new Error("INVALID_INDEX_LOGS");
      }
      return result.map((raw) => {
        const l = raw as Record<string, unknown>;
        if (
          typeof l.blockNumber !== "string" ||
          typeof l.logIndex !== "string" ||
          typeof l.removed !== "boolean" ||
          !Array.isArray(l.topics) ||
          ![l.blockHash, l.transactionHash].every(
            (v) => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v),
          ) ||
          typeof l.address !== "string" ||
          !/^0x[0-9a-f]{40}$/i.test(l.address) ||
          typeof l.data !== "string" ||
          !/^0x[0-9a-f]*$/i.test(l.data) ||
          !l.topics.every((v) => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v))
        ) {
          throw new Error("INVALID_INDEX_LOG");
        }
        const n = BigInt(l.blockNumber);
        if (
          n < q.fromBlock ||
          n > q.toBlock ||
          !q.addresses?.includes(l.address.toLowerCase() as Hex)
        ) {
          throw new Error("INDEX_LOG_OUTSIDE_RANGE");
        }
        return {
          chainId: 10143,
          blockNumber: n,
          blockHash: String(l.blockHash).toLowerCase(),
          transactionHash: String(l.transactionHash).toLowerCase(),
          logIndex: Number(BigInt(l.logIndex)),
          address: l.address.toLowerCase(),
          topics: l.topics,
          data: l.data,
          removed: l.removed,
        } as ChainLog;
      });
    },
  };
}
/** No PostgreSQL locks span RPC work. A renewable lease fences all streams/projections. */
export async function runTokenIndexer(input: {
  store: PostgresLaunchIndexStore;
  rpc: Rpc;
  launchPolicy: string;
  indexerPolicy: string;
}) {
  const policy = parseTokenLaunchPolicy(input.launchPolicy),
    limits = tokenIndexerPolicySchema.parse(JSON.parse(input.indexerPolicy));
  const pool = input.store.pool,
    chain = "eip155:10143",
    owner = randomUUID();
  const admitted = await pool.query(
    `INSERT INTO launch.indexer_admission(chain,owner,expires_at,day,requests) VALUES($1,$2,clock_timestamp()+make_interval(secs=>$3),to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD'),0)
    ON CONFLICT(chain) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE launch.indexer_admission.expires_at<clock_timestamp() OR launch.indexer_admission.owner IS NULL RETURNING chain`,
    [chain, owner, limits.leaseSeconds],
  );
  if (!admitted.rowCount) {
    return { kind: "busy" };
  }
  input.store.admissionFence = { chain, owner };
  let calls = 0;
  let stopped = false;
  let nextLane = 0;
  const lanes = Array.from({ length: 4 }, () => Promise.resolve());
  const rpc: Rpc = {
    call(method, params) {
      const lane = nextLane++ % lanes.length;
      const request = lanes[lane]!.then(async () => {
        if (stopped) {
          throw new Error("INDEX_PASS_STOPPED");
        }
        if (++calls > limits.rpcRequestsPerPass) {
          throw new Error("INDEX_PASS_BUDGET_EXHAUSTED");
        }
        const reserved = await pool.query(
          `UPDATE launch.indexer_admission SET requests=CASE WHEN day=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') THEN requests+1 ELSE 1 END,
      day=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD'),expires_at=clock_timestamp()+make_interval(secs=>$3)
      WHERE chain=$1 AND owner=$2 AND expires_at>clock_timestamp() AND (day<>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') OR requests<$4) RETURNING chain`,
          [chain, owner, limits.leaseSeconds, limits.rpcRequestsPerDay],
        );
        if (!reserved.rowCount) {
          throw new Error("INDEX_LEASE_OR_DAILY_BUDGET_UNAVAILABLE");
        }
        return input.rpc.call(method, params);
      });
      lanes[lane] = request.then(
        () => undefined,
        () => {
          stopped = true;
        },
      );
      return request;
    },
  };
  const uncachedReader = tokenChainReader(rpc);
  const blockReads = new Map<bigint, Promise<BlockRef>>();
  let tip: Promise<BlockRef> | undefined;
  // A pass reads one bounded snapshot. Shared block ancestry is not fetched once per contract.
  const reader: ChainReader = {
    ...uncachedReader,
    getLatestBlock: () => (tip ??= uncachedReader.getLatestBlock()),
    getBlock: (n) => {
      let pending = blockReads.get(n);
      if (!pending) {
        pending = uncachedReader.getBlock(n);
        blockReads.set(n, pending);
      }
      return pending;
    },
  };
  async function read(
    address: string,
    abi: readonly unknown[],
    name: string,
    args: unknown[] = [],
    at?: bigint,
  ) {
    return decodeFunctionResult({
      abi: abi as Abi,
      functionName: name,
      data: await reader.call({
        to: address as Hex,
        data: encodeFunctionData({ abi: abi as Abi, functionName: name, args }),
        ...(at === undefined ? {} : { blockNumber: at }),
      }),
    });
  }
  try {
    if (BigInt(String(await rpc.call("eth_chainId", []))) !== 10143n) {
      throw new Error("WRONG_INDEX_CHAIN");
    }
    for (const d of [
      policy.factory,
      policy.adapter,
      policy.escrow,
      policy.locker,
      ...(policy.venue === "uniswap_v4"
        ? [
            policy.poolManager,
            policy.positionManager,
            policy.stateView,
            policy.permit2,
            policy.quote,
          ]
        : [policy.router, policy.accountCore]),
    ]) {
      const code = await rpc.call("eth_getCode", [d.address, "latest"]);
      if (typeof code !== "string" || keccak256(code as Hex) !== d.codeHash) {
        throw new Error("INDEX_DEPLOYMENT_CHANGED");
      }
      if (d.implementation) {
        const slot = await rpc.call("eth_getStorageAt", [
          d.address,
          d.implementation.slot,
          "latest",
        ]);
        const impl = await rpc.call("eth_getCode", [d.implementation.address, "latest"]);
        if (
          typeof slot !== "string" ||
          slot.toLowerCase().slice(-40) !== d.implementation.address.slice(2) ||
          typeof impl !== "string" ||
          keccak256(impl as Hex) !== d.implementation.codeHash
        ) {
          throw new Error("INDEX_IMPLEMENTATION_CHANGED");
        }
      }
    }
    const curves = await pool.query<{ address: string; start: string }>(
      `SELECT p.address,min(e.block_number)::text AS start FROM market.pools p JOIN market.tokens t ON t.id=p.token_id
      JOIN market.chain_events e ON e.chain=t.chain AND e.tx_hash=t.launch_tx_hash AND e.event_name='LaunchCreated' AND lower(e.emitter)=$2
      JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash WHERE t.chain=$1 AND p.phase='pre_graduation' AND t.agent_id IS NOT NULL AND NOT e.orphaned AND NOT b.orphaned GROUP BY p.address ORDER BY (SELECT c.last_block FROM market.indexer_cursors c WHERE c.chain=$1 AND c.contract=p.address AND c.stream='token-launch-v1') NULLS FIRST,min(e.block_number),p.address LIMIT $3`,
      [chain, policy.factory.address, limits.maxCurvesPerPass],
    );
    const sources = [
      { contract: policy.factory.address, start: policy.factory.deploymentBlock },
      { contract: policy.adapter.address, start: policy.adapter.deploymentBlock },
      { contract: policy.escrow.address, start: policy.escrow.deploymentBlock },
      { contract: policy.locker.address, start: policy.locker.deploymentBlock },
      ...curves.rows.map((c) => ({ contract: c.address, start: Number(c.start) })),
    ];
    const progress = await Promise.all(
      sources.map(async (source) => ({
        source,
        cursor: await input.store.readCursor(chain, source.contract, "token-launch-v1"),
      })),
    );
    progress.sort(
      (a, b) =>
        Number(
          (a.cursor?.lastBlock ?? BigInt(a.source.start) - 1n) -
            (b.cursor?.lastBlock ?? BigInt(b.source.start) - 1n),
        ) || a.source.contract.localeCompare(b.source.contract),
    );
    const outcomes = [];
    for (const { source } of progress) {
      outcomes.push(
        await runIndexerPass({
          reader,
          store: input.store,
          source: {
            chain,
            contract: source.contract as Hex,
            stream: "token-launch-v1",
            deploymentBlock: BigInt(source.start),
          },
          decode: decodeLaunchLog,
          maxBlocks: 100n,
          confirmations: BigInt(policy.confirmations),
          confirmed: true,
        }),
      );
    }
    const projector = new PostgresLaunchProjector(pool);
    projector.admissionFence = { chain, owner };
    const erc20: Abi = [
      ...["name", "symbol"].map((name) => ({
        type: "function" as const,
        name,
        stateMutability: "view" as const,
        inputs: [],
        outputs: [{ type: "string" }],
      })),
      ...["decimals", "totalSupply"].map((name) => ({
        type: "function" as const,
        name,
        stateMutability: "view" as const,
        inputs: [],
        outputs: [{ type: name === "decimals" ? "uint8" : "uint256" }],
      })),
    ];
    await projector.project(chain, async (address, at) => {
      const existing = await pool.query<{
        name: string;
        ticker: string;
        decimals: number;
        totalSupply: string;
      }>(
        `SELECT name,ticker,decimals,total_supply::text AS "totalSupply" FROM market.tokens WHERE chain=$1 AND address=$2`,
        [chain, address],
      );
      if (existing.rows[0]) {
        const t = existing.rows[0];
        return {
          name: t.name,
          symbol: t.ticker.replace(/^\$/, ""),
          decimals: t.decimals,
          totalSupply: BigInt(t.totalSupply),
        };
      }
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        read(address, erc20, "name", [], BigInt(at)),
        read(address, erc20, "symbol", [], BigInt(at)),
        read(address, erc20, "decimals", [], BigInt(at)),
        read(address, erc20, "totalSupply", [], BigInt(at)),
      ]);
      if (
        decimals !== 18 ||
        totalSupply !== 21000000000000000000000000n ||
        typeof name !== "string" ||
        typeof symbol !== "string"
      ) {
        throw new Error("INVALID_LAUNCH_METADATA");
      }
      return { name, symbol, decimals, totalSupply };
    });
    if (policy.venue === "uniswap_v4") {
      const uniswap = new PostgresUniswapProjector(pool, policy, { chain, owner });
      await uniswap.project(async (token, at, hash) => {
        if ((await uncachedReader.getBlock(BigInt(at))).hash !== hash) {
          throw new Error("POSITION_REORG");
        }
        const locked = (await read(
          policy.locker.address,
          PicklerLiquidityLockerV2Abi,
          "getLockedPosition",
          [token],
          BigInt(at),
        )) as {
          tokenId: bigint;
          liquidity: bigint;
          tokenRemainder: bigint;
          quoteRemainder: bigint;
          poolKey: { currency0: Hex; currency1: Hex; fee: number; tickSpacing: number; hooks: Hex };
        };
        const [ownerId, liquidity, position] = await Promise.all([
          read(
            policy.positionManager.address,
            IUniswapV4ReadAbi,
            "ownerOf",
            [locked.tokenId],
            BigInt(at),
          ),
          read(
            policy.positionManager.address,
            IUniswapV4ReadAbi,
            "getPositionLiquidity",
            [locked.tokenId],
            BigInt(at),
          ),
          read(
            policy.positionManager.address,
            IUniswapV4ReadAbi,
            "getPoolAndPositionInfo",
            [locked.tokenId],
            BigInt(at),
          ),
        ]);
        const [key] = position as [typeof locked.poolKey, bigint];
        if (JSON.stringify(key) !== JSON.stringify(locked.poolKey)) {
          throw new Error("POSITION_KEY_CHANGED");
        }
        const poolId = keccak256(
          encodeAbiParameters(
            [
              { type: "address" },
              { type: "address" },
              { type: "uint24" },
              { type: "int24" },
              { type: "address" },
            ],
            [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
          ),
        );
        if ((await uncachedReader.getBlock(BigInt(at))).hash !== hash) {
          throw new Error("POSITION_REORG");
        }
        return {
          owner: String(ownerId),
          poolId,
          positionId: String(locked.tokenId),
          liquidity: String(liquidity),
          lockedLiquidity: String(locked.liquidity),
          tokenRemainder: String(locked.tokenRemainder),
          quoteRemainder: String(locked.quoteRemainder),
          poolKey: key,
        };
      });
    } else {
      const kuru = new PostgresKuruProjector(pool, policy, { chain, owner });
      await kuru.project(async (vault, market, at, hash) => {
        if ((await uncachedReader.getBlock(BigInt(at))).hash !== hash) {
          throw new Error("POSITION_REORG");
        }
        const config = (await read(
          policy.adapter.address,
          PicklerGraduationAdapterKuruAbi,
          "config",
          [],
          BigInt(at),
        )) as { bands: unknown[] };
        const [ownerId, accountId, baseToken, quoteToken, baseReserved, quoteReserved] =
          await Promise.all([
            read(vault, PicklerKuruPositionVaultAbi, "accountId", [], BigInt(at)).then((id) =>
              read(
                policy.accountCore.address,
                IKuruAccountCoreAbi,
                "getAccountOwner",
                [id],
                BigInt(at),
              ),
            ),
            read(vault, PicklerKuruPositionVaultAbi, "accountId", [], BigInt(at)),
            read(market, IKuruOrderBookAbi, "baseToken", [], BigInt(at)),
            read(market, IKuruOrderBookAbi, "quoteToken", [], BigInt(at)),
            read(vault, PicklerKuruPositionVaultAbi, "baseReserved", [], BigInt(at)),
            read(vault, PicklerKuruPositionVaultAbi, "quoteReserved", [], BigInt(at)),
          ]);
        const positions = [];
        for (let i = 0; i < config.bands.length; i++) {
          const id = await read(
            vault,
            PicklerKuruPositionVaultAbi,
            "positionIds",
            [BigInt(i)],
            BigInt(at),
          );
          const p = (await read(
            market,
            IKuruOrderBookAbi,
            "getPassivePosition",
            [id],
            BigInt(at),
          )) as { ownerId: bigint; lowPrice: bigint; highPrice: bigint; shares: bigint };
          positions.push({
            id: String(id),
            owner: String(p.ownerId),
            low: Number(p.lowPrice),
            high: Number(p.highPrice),
            shares: String(p.shares),
          });
        }
        if ((await uncachedReader.getBlock(BigInt(at))).hash !== hash) {
          throw new Error("POSITION_REORG");
        }
        return {
          owner: String(ownerId).toLowerCase(),
          market,
          baseToken: String(baseToken).toLowerCase(),
          quoteToken: String(quoteToken).toLowerCase(),
          accountId: String(accountId),
          positions,
          tokenReserved: String(baseReserved),
          quoteReserved: String(quoteReserved),
        };
      });
    }
    const confirmedTip = (await reader.getLatestBlock()).number - BigInt(policy.confirmations);
    const caughtUp = outcomes.every(
      (outcome) =>
        outcome.kind === "idle" || (outcome.kind === "applied" && outcome.toBlock >= confirmedTip),
    );
    return { kind: "completed", calls, outcomes, caughtUp };
  } finally {
    stopped = true;
    await Promise.allSettled(lanes);
    delete input.store.admissionFence;
    await pool.query(
      "UPDATE launch.indexer_admission SET owner=NULL,expires_at=NULL WHERE chain=$1 AND owner=$2",
      [chain, owner],
    );
  }
}

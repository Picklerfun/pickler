import type { Pool } from "pg";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import { PicklerLaunchFactoryAbi } from "@pickler/chain";
import { TokenLaunchError, type TokenIntent, type TokenScope, type ChainLog } from "@pickler/core";
import type { Rpc } from "../chain/erc20.js";
import { decodeLaunchLog } from "../chain/launch-log-decoder.js";
import { PostgresLaunchProjector } from "../persistence/product/launch-projector.js";
import { readAgentToken } from "../studio/token-read.js";
import { tokenAgentKey } from "../studio/token-launch-store.js";
import type { TokenLaunchPolicy } from "./policy.js";

const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const QUANTITY = /^0x[0-9a-f]+$/i;
const hex = (v: string) => v.toLowerCase();
type Header = { hash: string; parentHash: string; number: string; timestamp: string };

/** Publish a single app launch from canonical evidence, independently of historical cursors. */
export function createConfirmedLaunchPublisher(pool: Pool, policy: TokenLaunchPolicy) {
  return async (scope: TokenScope, intent: TokenIntent, rpc: Rpc): Promise<void> => {
    const grant = intent.authorization;
    const prepared = intent.prepared;
    if (
      intent.action !== "launch" ||
      !grant ||
      !prepared ||
      !intent.txHash ||
      !HASH.test(intent.txHash) ||
      prepared.operationId !== intent.id ||
      prepared.chainId !== 10143 ||
      grant.chainId !== 10143 ||
      hex(grant.factory) !== policy.factory.address ||
      hex(prepared.destination) !== policy.factory.address ||
      grant.params.agentKey !== tokenAgentKey(10143, scope.agentId) ||
      hex(grant.params.creator) !== hex(prepared.sender) ||
      hex(grant.params.creatorFeeRecipient) !== hex(prepared.sender) ||
      policy.factory.implementation
    ) {
      throw new Error("INVALID_CONFIRMED_LAUNCH");
    }
    const chain = "eip155:10143";
    const txHash = hex(intent.txHash);
    const existing = await readAgentToken(pool, scope.agentId, 10143);
    if (existing.token) {
      const row = await pool.query(
        "SELECT 1 FROM market.tokens WHERE agent_id=$1 AND chain=$2 AND address=$3 AND launch_tx_hash=$4",
        [scope.agentId, chain, existing.token.address, txHash],
      );
      if (!row.rowCount) {
        throw new Error("CONFLICTING_CONFIRMED_LAUNCH");
      }
      return;
    }

    const unsigned = parseTransaction(prepared.unsignedTransaction as Hex);
    if (
      unsigned.type !== "eip1559" ||
      unsigned.r ||
      unsigned.chainId !== 10143 ||
      hex(unsigned.to ?? "") !== policy.factory.address ||
      !unsigned.data ||
      (unsigned.value ?? 0n) !== 0n
    ) {
      throw new Error("INVALID_CONFIRMED_TRANSACTION");
    }
    const call = decodeFunctionData({ abi: PicklerLaunchFactoryAbi, data: unsigned.data });
    if (call.functionName !== "createLaunch") {
      throw new Error("INVALID_CONFIRMED_TRANSACTION");
    }
    const [params, creatorAuthorization, grantNonce, grantDeadline, signature] = call.args;
    const expectedData = encodeFunctionData({
      abi: PicklerLaunchFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          ...grant.params,
          agentKey: grant.params.agentKey as Hex,
          creator: grant.params.creator as Hex,
          creatorFeeRecipient: grant.params.creatorFeeRecipient as Hex,
          metadataHash: grant.params.metadataHash as Hex,
          expectedConfigHash: grant.params.expectedConfigHash as Hex,
          nonce: BigInt(grant.params.nonce),
          deadline: BigInt(grant.params.deadline),
        },
        "0x",
        BigInt(grant.grantNonce),
        BigInt(grant.grantDeadline),
        grant.signature as Hex,
      ],
    });
    if (
      hex(unsigned.data) !== hex(expectedData) ||
      creatorAuthorization !== "0x" ||
      grantNonce !== BigInt(grant.grantNonce) ||
      grantDeadline !== BigInt(prepared.deadline) ||
      signature !== grant.signature
    ) {
      throw new Error("CONFIRMED_GRANT_MISMATCH");
    }
    if (BigInt(String(await rpc.call("eth_chainId", []))) !== 10143n) {
      throw new Error("CONFIRMATION_CHAIN_MISMATCH");
    }
    const code = await rpc.call("eth_getCode", [policy.factory.address, "latest"]);
    if (
      typeof code !== "string" ||
      !QUANTITY.test(code) ||
      keccak256(code as Hex) !== policy.factory.codeHash
    ) {
      throw new Error("CONFIRMATION_FACTORY_CHANGED");
    }
    const receipt = (await rpc.call("eth_getTransactionReceipt", [txHash])) as {
      transactionHash: string;
      blockHash: string;
      blockNumber: string;
      status: string;
      logs: Record<string, unknown>[];
    } | null;
    if (
      !receipt ||
      !HASH.test(receipt.blockHash) ||
      !QUANTITY.test(receipt.blockNumber) ||
      hex(receipt.transactionHash) !== txHash ||
      receipt.status !== "0x1" ||
      !Array.isArray(receipt.logs) ||
      receipt.logs.length > 1000
    ) {
      throw new Error("INVALID_CONFIRMED_RECEIPT");
    }
    const number = BigInt(receipt.blockNumber);
    const head = String(await rpc.call("eth_blockNumber", []));
    if (!QUANTITY.test(head) || number + BigInt(policy.confirmations) > BigInt(head)) {
      throw new Error("LAUNCH_NOT_CONFIRMED");
    }
    async function header(): Promise<Header> {
      const b = (await rpc.call("eth_getBlockByNumber", [
        receipt!.blockNumber,
        false,
      ])) as Header | null;
      if (
        !b ||
        !HASH.test(b.hash) ||
        !HASH.test(b.parentHash) ||
        !QUANTITY.test(b.number) ||
        !QUANTITY.test(b.timestamp) ||
        BigInt(b.number) !== number ||
        hex(b.hash) !== hex(receipt!.blockHash)
      ) {
        throw new Error("CONFIRMATION_REORG");
      }
      return b;
    }
    const block = await header();
    const transaction = (await rpc.call("eth_getTransactionByHash", [txHash])) as {
      hash: string;
      from: string;
      to: string;
      input: string;
      value: string;
      blockHash: string;
      blockNumber: string;
    } | null;
    if (
      !transaction ||
      hex(transaction.hash) !== txHash ||
      hex(transaction.from) !== hex(prepared.sender) ||
      hex(transaction.to) !== policy.factory.address ||
      hex(transaction.input) !== hex(expectedData) ||
      !QUANTITY.test(transaction.value) ||
      BigInt(transaction.value) !== 0n ||
      hex(transaction.blockHash) !== hex(block.hash) ||
      !QUANTITY.test(transaction.blockNumber) ||
      BigInt(transaction.blockNumber) !== number
    ) {
      throw new Error("CONFIRMED_TRANSACTION_MISMATCH");
    }
    const factoryLogs = receipt.logs.filter(
      (l) => typeof l.address === "string" && hex(l.address) === policy.factory.address,
    );
    const launches = factoryLogs
      .map((l) => {
        if (
          l.removed === true ||
          !HASH.test(String(l.blockHash)) ||
          hex(String(l.blockHash)) !== hex(block.hash) ||
          !HASH.test(String(l.transactionHash)) ||
          hex(String(l.transactionHash)) !== txHash ||
          !QUANTITY.test(String(l.blockNumber)) ||
          BigInt(String(l.blockNumber)) !== number ||
          !QUANTITY.test(String(l.logIndex)) ||
          !Array.isArray(l.topics) ||
          !l.topics.every((v) => typeof v === "string" && HASH.test(v)) ||
          typeof l.data !== "string" ||
          !/^0x(?:[0-9a-f]{2})*$/i.test(l.data)
        ) {
          throw new Error("INVALID_CONFIRMED_LOG");
        }
        const log: ChainLog = {
          chainId: 10143,
          blockNumber: number,
          blockHash: hex(block.hash) as Hex,
          transactionHash: txHash as Hex,
          logIndex: Number(BigInt(String(l.logIndex))),
          address: policy.factory.address as Hex,
          topics: l.topics as Hex[],
          data: l.data as Hex,
          removed: false,
        };
        return { log, decoded: decodeLaunchLog(log) };
      })
      .filter((l) => l.decoded?.eventName === "LaunchCreated");
    if (launches.length !== 1) {
      throw new Error("AMBIGUOUS_CONFIRMED_LAUNCH");
    }
    const { log, decoded } = launches[0]!;
    const args = decoded!.decoded as Record<string, string>;
    if (
      hex(args.agentKey ?? "") !== hex(params.agentKey) ||
      hex(args.creator ?? "") !== hex(params.creator) ||
      hex(args.metadataHash ?? "") !== hex(params.metadataHash) ||
      hex(args.presetHash ?? "") !== hex(params.expectedConfigHash) ||
      hex(args.quoteToken ?? "") !== policy.preset.quoteAddress ||
      !ADDRESS.test(args.token ?? "") ||
      !ADDRESS.test(args.curve ?? "") ||
      args.token === args.curve
    ) {
      throw new Error("CONFIRMED_EVENT_MISMATCH");
    }
    async function metadataRead(functionName: "name" | "symbol" | "decimals" | "totalSupply") {
      const value = await rpc.call("eth_call", [
        { to: args.token, data: encodeFunctionData({ abi: erc20Abi, functionName }) },
        receipt!.blockNumber,
      ]);
      return decodeFunctionResult({ abi: erc20Abi, functionName, data: value as Hex });
    }
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      metadataRead("name"),
      metadataRead("symbol"),
      metadataRead("decimals"),
      metadataRead("totalSupply"),
    ]);
    if (
      name !== params.name ||
      symbol !== params.symbol ||
      decimals !== 18 ||
      totalSupply !== 21000000000000000000000000n
    ) {
      throw new Error("CONFIRMED_METADATA_MISMATCH");
    }
    await header();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `launch:${scope.userId}:10143`,
      ]);
      const owner = await client.query(
        `SELECT 1 FROM identity.workspaces w JOIN agents.agents a ON a.workspace_id=w.id
         WHERE w.id=$1 AND w.owner_user_id=$2 AND w.is_active AND a.id=$3 FOR NO KEY UPDATE OF w,a`,
        [scope.workspaceId, scope.userId, scope.agentId],
      );
      if (!owner.rowCount) {
        throw new TokenLaunchError("TOKEN_OWNER_REQUIRED");
      }
      const operation = await client.query(
        `SELECT 1 FROM launch.operations WHERE id=$1 AND agent_id=$2 AND owner_id=$3 AND chain=$4
         AND action='launch' AND status IN ('submitting','confirming','included','unknown','finalized')
         AND payload->>'txHash'=$5 AND payload->'authorization'=$6::jsonb
         AND payload->'prepared'->>'unsignedTransaction'=$7 FOR SHARE`,
        [
          intent.id,
          scope.agentId,
          scope.userId,
          chain,
          txHash,
          JSON.stringify(grant),
          prepared.unsignedTransaction,
        ],
      );
      const recorded = await client.query(
        `SELECT 1 FROM launch.grants g JOIN launch.agent_keys k ON k.agent_id=g.agent_id AND k.chain=g.chain
         WHERE g.agent_id=$1 AND g.owner_id=$2 AND g.chain=$3 AND g.factory=$4 AND g.payload=$5::jsonb
           AND k.agent_key=$6 AND date_trunc('second',g.created_at)<=to_timestamp($7)
           AND g.expires_at>=to_timestamp($7) FOR SHARE OF g,k`,
        [
          scope.agentId,
          scope.userId,
          chain,
          policy.factory.address,
          JSON.stringify(grant),
          params.agentKey,
          Number(BigInt(block.timestamp)),
        ],
      );
      if (!operation.rowCount || !recorded.rowCount) {
        throw new Error("CONFIRMED_LAUNCH_NOT_REGISTERED");
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `market:${chain}`,
      ]);
      await client.query(
        "UPDATE market.chain_blocks SET orphaned=true WHERE chain=$1 AND number=$2 AND hash<>$3",
        [chain, Number(number), hex(block.hash)],
      );
      await client.query(
        "UPDATE market.chain_events SET orphaned=true WHERE chain=$1 AND block_number=$2 AND block_hash<>$3",
        [chain, Number(number), hex(block.hash)],
      );
      await client.query(
        `UPDATE launch.outbox SET status='failed',last_error='CHAIN_EVENT_ORPHANED'
         WHERE event_chain=$1 AND status='pending'
           AND event_block_hash IN (SELECT hash FROM market.chain_blocks WHERE chain=$1 AND number=$2 AND orphaned)`,
        [chain, Number(number)],
      );
      await client.query(
        `INSERT INTO market.chain_blocks(chain,hash,number,parent_hash,block_time,finality)
         VALUES($1,$2,$3,$4,to_timestamp($5),'confirmed') ON CONFLICT(chain,hash)
         DO UPDATE SET orphaned=false,finality='confirmed'`,
        [
          chain,
          hex(block.hash),
          Number(number),
          hex(block.parentHash),
          Number(BigInt(block.timestamp)),
        ],
      );
      await client.query(
        `INSERT INTO market.chain_events(chain,block_hash,tx_hash,log_index,block_number,emitter,event_name,abi_hash,topics,data,decoded)
         VALUES($1,$2,$3,$4,$5,$6,'LaunchCreated',$7,$8,$9,$10)
         ON CONFLICT(chain,block_hash,tx_hash,log_index) DO UPDATE SET orphaned=false`,
        [
          chain,
          hex(block.hash),
          txHash,
          log.logIndex,
          Number(number),
          log.address,
          decoded!.abiHash,
          JSON.stringify(log.topics),
          log.data,
          args,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const projector = new PostgresLaunchProjector(pool);
    await projector.projectReceipt(chain, txHash, async () => ({
      name: name as string,
      symbol: symbol as string,
      decimals: 18,
      totalSupply: totalSupply as bigint,
    }));
    const published = await readAgentToken(pool, scope.agentId, 10143);
    if (published.token?.address !== hex(args.token!)) {
      throw new Error("LAUNCH_PUBLICATION_PENDING");
    }
  };
}

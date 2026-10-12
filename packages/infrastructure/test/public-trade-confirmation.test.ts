import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  type Abi,
  type Hex,
} from "viem";
import { PicklerLaunchFactoryAbi, PicklerBondingCurveAbi } from "@pickler/chain";
import { tokenReferenceEconomics, tokenCurveMarket } from "@pickler/core";
import { tokenFixture } from "./token-fixture.js";
import { deploymentCode, uniswapLaunchPolicy } from "./launch-policy-fixture.js";
import { tokenAgentKey } from "../src/studio/token-launch-store.js";
import { createPublicTradeConfirmation } from "../src/launch/public-trade-confirmation.js";
import { PostgresLaunchReadModel } from "../src/persistence/product/launch-read-model.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as Hex;
const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const chain = "eip155:10143";
const token = address("a"),
  curve = address("b"),
  wallet = address("c");
const txHash = hash("d"),
  blockHash = hash("e"),
  parentHash = hash("f");
const timestamp = Math.floor(Date.now() / 1000);

async function fixture(t: Parameters<typeof tokenFixture>[0], side: "buy" | "sell" = "buy") {
  const f = await tokenFixture(t);
  const policy = uniswapLaunchPolicy();
  const economics = tokenReferenceEconomics({ address: policy.preset.quoteAddress, decimals: 6 });
  const id = randomUUID();
  await f.store.pool.query(
    `INSERT INTO market.tokens(id,agent_id,ticker,name,chain,address,decimals,total_supply,
     quote_address,quote_symbol,quote_decimals,status,launch_tx_hash,launched_at)
     VALUES($1,$2,'$TEST','Controlled',$3,$4,18,$5,$6,'AUSD',6,'pre_graduation',$7,now())`,
    [
      id,
      f.scope.agentId,
      chain,
      token,
      economics.totalSupply,
      policy.preset.quoteAddress,
      hash("1"),
    ],
  );
  await f.store.pool.query(
    `INSERT INTO market.chain_blocks(chain,hash,number,parent_hash,block_time,finality)
     VALUES($1,$2,10,$3,to_timestamp($4),'confirmed')`,
    [chain, hash("2"), hash("3"), timestamp - 30],
  );
  await f.store.pool.query(
    `INSERT INTO market.chain_events(chain,block_hash,tx_hash,log_index,block_number,emitter,event_name,abi_hash,topics,data,decoded)
     VALUES($1,$2,$3,0,10,$4,'LaunchCreated',$5,'[]','0x',$6)`,
    [
      chain,
      hash("2"),
      hash("1"),
      policy.factory.address,
      "a".repeat(64),
      { token, curve, presetHash: policy.preset.configHash },
    ],
  );
  await f.store.pool.query(
    `INSERT INTO market.pools(token_id,phase,venue,address,opened_tx_hash,opened_at)
     VALUES($1,'pre_graduation','pickler_curve',$2,$3,now())`,
    [id, curve, hash("1")],
  );
  await f.store.pool.query(
    `INSERT INTO market.indexer_cursors(chain,contract,stream,last_block,last_block_hash)
     VALUES($1,$2,'events',10,$3)`,
    [chain, policy.factory.address, hash("2")],
  );
  const eventName = side === "buy" ? "CurveBought" : "CurveSold";
  const eventAbi = PicklerBondingCurveAbi.find((x) => x.type === "event" && x.name === eventName)!;
  assert.equal(eventAbi.type, "event");
  const values =
    side === "buy"
      ? {
          payer: wallet,
          recipient: wallet,
          grossQuoteIn: 1000000n,
          netQuoteIn: 990000n,
          tokensOut: 2000n * 10n ** 18n,
          totalFee: 10000n,
          reserveAfter: 990000n,
          netSoldAfter: 2000n * 10n ** 18n,
        }
      : {
          seller: wallet,
          recipient: wallet,
          tokensIn: 1000n * 10n ** 18n,
          grossQuoteOut: 500000n,
          netQuoteOut: 495000n,
          totalFee: 5000n,
          reserveAfter: 500000n,
          netSoldAfter: 1000n * 10n ** 18n,
        };
  const fields = eventAbi.inputs.filter((x) => !x.indexed);
  const data = encodeAbiParameters(
    fields,
    fields.map((x) => values[x.name as keyof typeof values]) as never,
  );
  const log = {
    address: curve,
    topics: encodeEventTopics({ abi: PicklerBondingCurveAbi, eventName, args: values }),
    data,
    logIndex: "0x8",
    blockNumber: "0x14",
    blockHash,
    transactionHash: txHash,
    removed: false,
  };
  const receipt = {
    transactionHash: txHash,
    blockNumber: "0x14",
    blockHash,
    status: "0x1",
    logs: [log],
  };
  const tx = {
    hash: txHash,
    from: wallet,
    to: curve,
    blockHash,
    blockNumber: "0x14",
    value: "0x0",
    input: encodeFunctionData({
      abi: PicklerBondingCurveAbi,
      functionName: side === "buy" ? "buyExactInput" : "sellExactInput",
      args: [side === "buy" ? 1000000n : 1000n * 10n ** 18n, 1n, wallet, BigInt(timestamp + 300)],
    }),
  };
  const header = {
    hash: blockHash,
    number: "0x14",
    parentHash,
    timestamp: `0x${timestamp.toString(16)}`,
  };
  const changes: Record<string, unknown> = {};
  let calls = 0,
    reserves = 0;
  const confirm = createPublicTradeConfirmation({
    pool: f.store.pool,
    policy,
    reserve: async () => {
      reserves++;
    },
    rpc: {
      async call(method, params) {
        calls++;
        if (method === "eth_chainId") {
          return changes.chain ?? "0x279f";
        }
        if (method === "eth_getTransactionReceipt") {
          return changes.pending ? null : receipt;
        }
        if (method === "eth_blockNumber") {
          return changes.tip ?? "0x16";
        }
        if (method === "eth_getBlockByNumber") {
          return header;
        }
        if (method === "eth_getCode") {
          return changes.code ?? deploymentCode;
        }
        if (method === "eth_getTransactionByHash") {
          return tx;
        }
        if (method === "eth_call") {
          const q = params[0] as { to: string; data: Hex };
          const abi: Abi =
            q.to === policy.factory.address ? PicklerLaunchFactoryAbi : PicklerBondingCurveAbi;
          const fn = decodeFunctionData({ abi, data: q.data }).functionName;
          const result =
            fn === "getLaunch"
              ? {
                  token,
                  curve,
                  creator: wallet,
                  creatorFeeRecipient: wallet,
                  agentKey: changes.agentKey ?? tokenAgentKey(10143, f.scope.agentId),
                  quoteToken: policy.preset.quoteAddress,
                  presetHash: policy.preset.configHash,
                  creationBlock: 10n,
                }
              : {
                  token,
                  quoteToken: policy.preset.quoteAddress,
                  deployer: policy.deployer.address,
                }[fn];
          return encodeFunctionResult({ abi, functionName: fn, result });
        }
        throw new Error("Unexpected controlled RPC " + method);
      },
    },
  });
  const context = { agentId: f.scope.agentId, token, chainId: 10143 };
  const model = new PostgresLaunchReadModel(f.store.pool, undefined, {
    chain,
    factory: policy.factory.address,
    configHash: policy.preset.configHash,
    economics,
  });
  return {
    ...f,
    confirm,
    context,
    model,
    economics,
    receipt,
    tx,
    header,
    changes,
    log,
    values,
    calls: () => calls,
    reserves: () => reserves,
    read: () => model.getLaunch(id),
  };
}

for (const side of ["buy", "sell"] as const) {
  test(`verified ${side} receipt updates metrics immediately and replay is idempotent`, async (t) => {
    const f = await fixture(t, side);
    const input = { wallet, txHash };
    const before = await f.store.pool.query(
      "SELECT * FROM market.indexer_cursors ORDER BY chain,contract,stream",
    );
    assert.deepEqual(await f.confirm(f.context, input), { status: "confirmed" });
    const market = (await f.read())!.data.market!;
    assert.equal(market.netSold, f.values.netSoldAfter.toString());
    assert.equal(market.realQuoteReserve, f.values.reserveAfter.toString());
    assert.equal(market.priceWad, tokenCurveMarket(f.economics, market.netSold!).priceWad);
    assert.equal(market.history.length, 2);
    assert.equal(market.recentTrades[0]?.txHash, txHash);
    const calls = f.calls();
    assert.ok(calls <= 40);
    assert.deepEqual(await f.confirm(f.context, input), { status: "confirmed" });
    assert.equal(f.calls(), calls, "recorded canonical receipt avoids provider reads");
    assert.deepEqual(
      (
        await f.store.pool.query(
          "SELECT * FROM market.indexer_cursors ORDER BY chain,contract,stream",
        )
      ).rows,
      before.rows,
    );
    assert.equal(
      (
        await f.store.pool.query("SELECT count(*) FROM market.chain_events WHERE tx_hash=$1", [
          txHash,
        ])
      ).rows[0].count,
      "1",
    );
  });
}

test("concurrent receipt requests append once", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([1, 2, 3].map(() => f.confirm(f.context, { wallet, txHash })));
  assert.ok(results.every((x) => x.status === "confirmed"));
  assert.equal(
    (
      await f.store.pool.query("SELECT count(*) FROM market.chain_events WHERE tx_hash=$1", [
        txHash,
      ])
    ).rows[0].count,
    "1",
  );
});

test("pending, shallow and reverted receipts never append activity", async (t) => {
  const f = await fixture(t);
  f.changes.pending = true;
  assert.deepEqual(await f.confirm(f.context, { wallet, txHash }), { status: "pending" });
  delete f.changes.pending;
  f.changes.tip = "0x14";
  assert.deepEqual(await f.confirm(f.context, { wallet, txHash }), { status: "pending" });
  delete f.changes.tip;
  f.receipt.status = "0x0";
  assert.deepEqual(await f.confirm(f.context, { wallet, txHash }), { status: "reverted" });
  assert.equal((await f.read())!.data.market!.history.length, 1);
});

test("foreign wallet, altered deployment, identity and receipt evidence are rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.confirm(f.context, { wallet: address("9"), txHash }));
  f.changes.agentKey = hash("0");
  await assert.rejects(f.confirm(f.context, { wallet, txHash }));
  delete f.changes.agentKey;
  f.changes.code = "0x01";
  await assert.rejects(f.confirm(f.context, { wallet, txHash }));
  delete f.changes.code;
  f.log.removed = true;
  await assert.rejects(f.confirm(f.context, { wallet, txHash }));
  assert.equal((await f.read())!.data.market!.history.length, 1);
});

for (const orphaned of [false, true]) {
  test(`conflicting ${orphaned ? "orphaned" : "canonical"} history is preserved for indexer reconciliation`, async (t) => {
    const f = await fixture(t);
    await f.store.pool.query(
      `INSERT INTO market.chain_blocks(chain,hash,number,parent_hash,block_time,finality,orphaned)
       VALUES($1,$2,20,$3,to_timestamp($4),'confirmed',$5)`,
      [chain, orphaned ? blockHash : hash("9"), parentHash, timestamp, orphaned],
    );
    const before = (await f.store.pool.query("SELECT * FROM market.chain_blocks ORDER BY number"))
      .rows;
    assert.deepEqual(await f.confirm(f.context, { wallet, txHash }), { status: "pending" });
    assert.deepEqual(
      (await f.store.pool.query("SELECT * FROM market.chain_blocks ORDER BY number")).rows,
      before,
    );
    assert.equal((await f.read())!.data.market!.history.length, 1);
  });
}

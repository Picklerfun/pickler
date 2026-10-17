import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { tokenCurveMarket, tokenReferenceEconomics } from "@pickler/core";
import { freshnessReadSchema, launchDetailSchema, tokenMarketSchema } from "@pickler/api-schema";
import { createTestStore } from "./database.js";
import { PostgresLaunchReadModel } from "../src/persistence/product/launch-read-model.js";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}`;
const chain = "eip155:10143";
const token = address("2");
const curve = address("3");
const factory = address("1");
const quote = address("4");
const configHash = hash(1000);
const terms = tokenReferenceEconomics({ address: quote, decimals: 6 });

async function setup(t: Parameters<typeof createTestStore>[0]) {
  const store = await createTestStore(t);
  const pool = store.pool;
  const id = randomUUID();
  const model = new PostgresLaunchReadModel(pool, undefined, {
    chain,
    factory,
    configHash,
    economics: terms,
  });
  await pool.query(
    `INSERT INTO market.tokens(id,ticker,name,chain,address,decimals,total_supply,quote_address,quote_symbol,quote_decimals,status,launch_tx_hash,launched_at)
    VALUES($1,'$TOKEN','Token',$2,$3,18,$4,$5,'AUSD',6,'pre_graduation',$6,now()-interval '3 hours')`,
    [id, chain, token, terms.totalSupply, quote, hash(1)],
  );
  async function event(
    number: number,
    eventName: string,
    decoded: object,
    emitter = curve,
    finality = "confirmed",
    hours = 1,
  ) {
    await pool.query(
      `INSERT INTO market.chain_blocks(chain,hash,number,parent_hash,block_time,finality)
      VALUES($1,$2,$3,$4,now()-make_interval(hours=>$5),$6)`,
      [chain, hash(number + 100), number, hash(number + 99), hours, finality],
    );
    await pool.query(
      `INSERT INTO market.chain_events(chain,block_hash,tx_hash,log_index,block_number,emitter,event_name,abi_hash,topics,data,decoded)
      VALUES($1,$2,$3,0,$4,$5,$6,$7,'[]','0x',$8)`,
      [
        chain,
        hash(number + 100),
        hash(number),
        number,
        emitter,
        eventName,
        "a".repeat(64),
        JSON.stringify(decoded),
      ],
    );
  }
  await event(
    1,
    "LaunchCreated",
    { token, curve, presetHash: configHash },
    factory,
    "confirmed",
    3,
  );
  return { pool, model, id, event };
}
const buy = {
  recipient: address("5"),
  tokensOut: "2000000000000000000000",
  grossQuoteIn: "1010000",
  netQuoteIn: "1000000",
  totalFee: "10000",
  reserveAfter: "1000000",
  netSoldAfter: "2000000000000000000000",
};
const sell = {
  seller: address("5"),
  tokensIn: "1000000000000000000000",
  grossQuoteOut: "500000",
  netQuoteOut: "495000",
  totalFee: "5000",
  reserveAfter: "500000",
  netSoldAfter: "1000000000000000000000",
};

test("chain/address and UUID reads expose the committed initial state without inventing trades", async (t) => {
  const { model, id } = await setup(t);
  const read = await model.getLaunch(`${chain}:${token.toUpperCase().replace("0X", "0x")}`);
  assert.ok(read);
  assert.equal(read.data.id, id);
  assert.equal(read.data.market?.priceWad, terms.initialPriceWad);
  assert.equal(read.data.market?.progressBps, 0);
  assert.equal(read.data.market?.realQuoteReserve, "0");
  assert.deepEqual(read.data.market?.recentTrades, []);
  assert.equal(read.data.market?.history.length, 1);
  assert.equal(read.data.market?.priceMovement, null);
  assert.equal((await model.getLaunch(id))?.data.id, id);
  assert.equal(await model.getLaunch(`eip155:143:${token}`), null);
  assert.equal(await model.getLaunch("garbage"), null);
  freshnessReadSchema(launchDetailSchema).parse(read);
});

test("canonical buy/sell state, actual fee separation, history and transaction identity", async (t) => {
  const { model, event } = await setup(t);
  await event(2, "CurveBought", buy, curve, "confirmed", 2);
  await event(3, "CurveSold", sell, curve, "confirmed", 1);
  await event(4, "CurveBought", buy, address("6"));
  await event(5, "CurveBought", buy, curve, "observed");
  const read = await model.getLaunch(`${chain}:${token}`);
  const market = read!.data.market!;
  assert.equal(market.volume24h, "1510000");
  assert.equal(market.netSold, sell.netSoldAfter);
  assert.equal(market.realQuoteReserve, "500000");
  assert.equal(market.priceWad, tokenCurveMarket(terms, sell.netSoldAfter).priceWad);
  assert.deepEqual(
    market.recentTrades.map((row) => [row.side, row.txHash]),
    [
      ["sell", hash(3)],
      ["buy", hash(2)],
    ],
  );
  assert.equal(market.recentTrades[0]?.priceWad, "500000000000000");
  assert.equal(market.history.length, 3);
  assert.equal(market.history[0]?.priceWad, terms.initialPriceWad);
  assert.equal(market.observedBlock, "3");
  freshnessReadSchema(launchDetailSchema).parse(read);
});

test("orphaned events and blocks disappear immediately without waiting for projector cleanup", async (t) => {
  const { model, event, pool } = await setup(t);
  await event(2, "CurveBought", buy);
  await event(3, "CurveSold", sell);
  await pool.query("UPDATE market.chain_events SET orphaned=true WHERE tx_hash=$1", [hash(3)]);
  assert.equal(
    (await model.getLaunch(`${chain}:${token}`))?.data.market?.netSold,
    buy.netSoldAfter,
  );
  await pool.query("UPDATE market.chain_blocks SET orphaned=true WHERE number=2");
  const read = await model.getLaunch(`${chain}:${token}`);
  assert.ok(read?.data.market);
  const market = read.data.market;
  assert.equal(market.volume24h, "0");
  assert.equal(market.progressBps, 0);
  await pool.query("UPDATE market.chain_blocks SET orphaned=true WHERE number=1");
  assert.equal((await model.getLaunch(`${chain}:${token}`))?.data.market, null);
});

test("unknown historical presets keep their own execution prices without reference allocations", async (t) => {
  const { model, event, pool } = await setup(t);
  await event(2, "CurveBought", buy);
  await pool.query(
    "UPDATE market.chain_events SET decoded=jsonb_set(decoded,'{presetHash}',to_jsonb($1::text)) WHERE event_name='LaunchCreated'",
    [hash(999)],
  );
  const read = await model.getLaunch(`${chain}:${token}`);
  assert.ok(read?.data.market);
  const market = read.data.market;
  assert.equal(market.terms, null);
  assert.equal(market.progressBps, null);
  assert.equal(market.priceKind, "last_trade");
  assert.equal(market.priceWad, "500000000000000");
  assert.equal(market.realQuoteReserve, "1000000");
});

test("history sampling and recent rows are bounded and ordered by chain position", async (t) => {
  const { model, event } = await setup(t);
  for (let number = 2; number <= 25; number++) {
    await event(number, "CurveBought", {
      ...buy,
      netSoldAfter: String(BigInt(number) * BigInt(buy.tokensOut)),
    });
  }
  const read = await model.getLaunch(`${chain}:${token}`);
  assert.ok(read?.data.market);
  const market = read.data.market;
  assert.equal(market.recentTrades.length, 20);
  assert.equal(market.recentTrades[0]?.txHash, hash(25));
  assert.equal(market.historyTruncated, true);
  assert.equal(market.observedBlock, "25");
});

test("two trades within one hour retain the real launch anchor and both price changes", async (t) => {
  const { model, event } = await setup(t);
  await event(2, "CurveBought", buy);
  await event(3, "CurveSold", sell);

  const market = (await model.getLaunch(`${chain}:${token}`))!.data.market!;

  assert.equal(market.history.length, 3);
  assert.equal(market.history[0]?.priceWad, terms.initialPriceWad);
  assert.equal(market.history[1]?.priceWad, tokenCurveMarket(terms, buy.netSoldAfter).priceWad);
  assert.equal(market.history[2]?.priceWad, tokenCurveMarket(terms, sell.netSoldAfter).priceWad);
  assert.equal(market.historyTruncated, false);
  assert.equal(market.priceMovement?.direction, "down");
  assert.equal(market.priceMovement?.fromAt, market.history[1]?.at);
  assert.equal(market.priceMovement?.toAt, market.history[2]?.at);
  assert.ok(BigInt(market.priceMovement!.changeBps) <= 0n);

  const legacy = { ...market };
  delete legacy.priceMovement;
  assert.equal(tokenMarketSchema.safeParse(legacy).success, true);
  assert.equal(tokenMarketSchema.safeParse({ ...market, priceMovement: null }).success, true);
  assert.equal(
    tokenMarketSchema.safeParse({
      ...market,
      priceMovement: { ...market.priceMovement, direction: "up", changeBps: "-1" },
    }).success,
    false,
  );
  assert.equal(
    tokenMarketSchema.safeParse({
      ...market,
      priceMovement: { ...market.priceMovement, changeBps: "invalid" },
    }).success,
    false,
  );
});

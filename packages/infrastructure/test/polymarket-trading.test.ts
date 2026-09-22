import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OrderSide,
  OrderType,
  type createSecureClient,
  type TypedDataPayload,
} from "@polymarket/client";
import { PolymarketTrading, tradingOrderHash } from "../src/polymarket/trading.js";
import { PolymarketData } from "../src/polymarket/market-data.js";
import type { LivePreview, LiveOrder } from "@pickler/core";
const credentials = {
  privateKey: `0x${"0".repeat(63)}1`,
  signer: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  wallet: `0x${"a".repeat(40)}`,
  apiKey: "fixture",
  secret: "fixture",
  passphrase: "fixture",
};
const hash = `0x${"1".repeat(64)}`;
const preview = { marketId: "1", outcomeId: "2", budget: "5", limitPrice: "0.5" } as LivePreview;
const signal = () => AbortSignal.timeout(5000);
type Client = Awaited<ReturnType<typeof createSecureClient>>;
test("deposit-wallet envelope hashes the inner exchange order consistently", () => {
  const payload = {
    domain: {
      chainId: 137,
      name: "Polymarket CTF Exchange",
      version: "2",
      verifyingContract: `0x${"b".repeat(40)}`,
    },
    types: { Order: [{ name: "salt", type: "uint256" }] },
    primaryType: "Order",
    message: { salt: 1n },
  } as unknown as TypedDataPayload;
  assert.equal(
    tradingOrderHash(payload),
    tradingOrderHash({
      ...payload,
      primaryType: "TypedDataSign",
      message: { contents: payload.message },
    }),
  );
  assert.throws(() => tradingOrderHash({ ...payload, domain: { ...payload.domain, chainId: 1 } }));
});
test("SDK order preparation fixes BUY/FOK, total cap and outcome; invalid maker cannot submit", async () => {
  let request: unknown;
  const client = {
    createMarketOrder: async (input: unknown) => {
      request = input;
      return {
        orderType: OrderType.FOK,
        maker: credentials.wallet,
        tokenId: "2",
        makerAmount: "4900000",
        takerAmount: "10000000",
        side: OrderSide.BUY,
      };
    },
  } as unknown as Client;
  const provider = new PolymarketTrading(credentials, undefined, async (onHash) => {
    onHash?.(hash);
    return client;
  });
  assert.equal((await provider.sign(preview, signal())).hash, hash);
  assert.deepEqual(request, {
    tokenId: "2",
    side: OrderSide.BUY,
    amount: "5",
    maxSpend: "5",
    maxPrice: "0.5",
    orderType: OrderType.FOK,
  });
  const bad = new PolymarketTrading(credentials, undefined, async (onHash) => {
    onHash?.(hash);
    return {
      createMarketOrder: async () => ({
        orderType: OrderType.FOK,
        maker: credentials.signer,
        tokenId: "2",
        makerAmount: "4900000",
        takerAmount: "10000000",
        side: OrderSide.BUY,
      }),
    } as unknown as Client;
  });
  await assert.rejects(bad.sign(preview, signal()), { code: "TRADING_SIGNED_ORDER_INVALID" });
});
test("settlement requires confirmed trades and indexed position, not merely accepted order status", async () => {
  let status = "MINED";
  let hasPosition = false;
  const client = {
    fetchOrder: async () => ({
      id: hash,
      makerAddress: credentials.wallet,
      tokenId: "2",
      status: "MATCHED",
      sizeMatched: "10",
      associateTrades: ["trade"],
    }),
    listAccountTrades: () => ({
      firstPage: async () => ({
        items: [
          {
            id: "trade",
            takerOrderId: hash,
            status,
            transactionHash: `0x${"3".repeat(64)}`,
            size: "10",
          },
        ],
      }),
    }),
    listPositions: () => ({
      firstPage: async () => ({
        items: hasPosition ? [{ assetId: "2", wallet: credentials.wallet, currentSize: "10" }] : [],
      }),
    }),
  } as unknown as Client;
  const provider = new PolymarketTrading(credentials, undefined, async () => client);
  const order = { orderHash: hash, preview } as LiveOrder;
  assert.equal((await provider.reconcile(order, signal())).status, "unknown");
  status = "CONFIRMED";
  assert.equal((await provider.reconcile(order, signal())).status, "unknown");
  hasPosition = true;
  const result = await provider.reconcile(order, signal());
  assert.equal(result.status, "settled");
  if (result.status === "settled") {
    assert.equal(result.fill.costUpperBound, "5");
    assert.equal(result.fill.shares, "10.000000");
  }
});
test("preview rejects insufficient depth and treats provider minimum size as shares", async () => {
  let size = "100";
  const markets = {
    get: async () => ({ id: "1" }),
    conditions: async () => ({ feeRate: "0", feeExponent: 1, minimumNotional: "6" }),
    book: async () => ({ observedAt: new Date().toISOString(), asks: [{ price: "0.4", size }] }),
  } as unknown as PolymarketData;
  const provider = new PolymarketTrading(credentials, markets);
  assert.equal((await provider.preview(preview, signal())).estimatedShares, "12.500000");
  size = "1";
  await assert.rejects(provider.preview(preview, signal()), { code: "TRADING_DEPTH" });
});

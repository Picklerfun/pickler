/** Controlled market observations for the real production component. No provider is contacted. */
import type { LaunchDetailDto, ReadDto } from "@pickler/api-schema";
import {
  curveGrossFromNet,
  quoteInForTokensOut,
  quoteOutForTokensIn,
  splitCurveFee,
  tokenCurveMarket,
  tokenReferenceEconomics,
  tokenTradePriceWad,
} from "@pickler/core";

export function sampleTokenMarket(now = Date.now()): ReadDto<LaunchDetailDto> {
  const quoteAddress = `0x${"4".repeat(40)}`;
  const economics = tokenReferenceEconomics({ address: quoteAddress, decimals: 6 });
  const observations = [0, 2_000_000, 5_000_000, 4_500_000].map((sold, index) => ({
    at: new Date(now - (3 - index) * 3_600_000 - 30_000).toISOString(),
    priceWad: tokenCurveMarket(economics, (BigInt(sold) * 10n ** 18n).toString()).priceWad,
  }));
  const config = {
    virtualTokenReserve: BigInt(economics.virtualTokenReserve),
    virtualQuoteReserve: BigInt(economics.virtualQuoteReserve),
    saleAllocation: BigInt(economics.saleAllocation),
  };
  const unit = 10n ** 18n;
  const bought = 3_000_000n * unit;
  const sold = 500_000n * unit;
  const firstReserve = quoteInForTokensOut(config, 0n, 2_000_000n * unit);
  const buyNet = quoteInForTokensOut(config, 2_000_000n * unit, bought);
  const buyGross = curveGrossFromNet(buyNet, economics.buyFeeBps);
  const sellGross = quoteOutForTokensIn(config, 5_000_000n * unit, sold);
  const sell = splitCurveFee(sellGross, economics.sellFeeBps);
  const recentTrades = [
    {
      side: "sell" as const,
      tokenAmount: sold.toString(),
      quoteAmount: sell.net.toString(),
      feeAmount: sell.fee.toString(),
    },
    {
      side: "buy" as const,
      tokenAmount: bought.toString(),
      quoteAmount: buyGross.toString(),
      feeAmount: (buyGross - buyNet).toString(),
    },
  ].map((trade, index) => ({
    ...trade,
    trader: `0x${"5".repeat(40)}`,
    blockNumber: String(1234 - index),
    txHash: `0x${String(index + 1).repeat(64)}`,
    logIndex: 0,
    blockTime: observations[3 - index]!.at,
    priceWad: tokenTradePriceWad({ ...trade, tokenDecimals: 18, quoteDecimals: 6 }),
  }));
  const netSold = "4500000000000000000000000";
  const state = tokenCurveMarket(economics, netSold);
  return {
    asOfBlock: "1234",
    asOfBlockHash: `0x${"a".repeat(64)}`,
    indexedAt: new Date(now).toISOString(),
    finality: "confirmed",
    stale: false,
    data: {
      id: "eip155:10143:0x1111111111111111111111111111111111111111",
      chainId: "eip155:10143",
      address: `0x${"1".repeat(40)}`,
      ticker: "$HALF",
      name: "Halftime",
      imageUri: null,
      phase: "pre_graduation",
      agentId: "halftime",
      quote: { chainId: "eip155:10143", address: quoteAddress, symbol: "AUSD", decimals: 6 },
      totalSupply: economics.totalSupply,
      launchedAt: observations[0]!.at,
      graduatedAt: null,
      curve: null,
      pool: null,
      market: {
        version: 1,
        tokenDecimals: 18,
        priceKind: "curve",
        ...state,
        volume24h: (
          curveGrossFromNet(firstReserve, economics.buyFeeBps) +
          buyGross +
          sellGross
        ).toString(),
        windowEnd: new Date(now).toISOString(),
        observedAt: observations[3]!.at,
        observedBlock: "1234",
        netSold,
        realQuoteReserve: (firstReserve + buyNet - sellGross).toString(),
        terms: {
          totalSupply: economics.totalSupply,
          saleAllocation: economics.saleAllocation,
          lpAllocation: economics.lpAllocation,
          buyFeeBps: 100,
          sellFeeBps: 100,
        },
        history: observations,
        historyTruncated: false,
        recentTrades,
      },
    },
  };
}

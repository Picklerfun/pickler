import { curveMarginalPriceWad } from "./curve-math.js";
import type { TokenReferenceEconomics } from "./token-economics.js";

/** Informational prices only. Executable quotes still come from the curve contract. */
export function tokenTradePriceWad(input: {
  side: "buy" | "sell";
  tokenAmount: string;
  quoteAmount: string;
  feeAmount: string;
  tokenDecimals: number;
  quoteDecimals: number;
}): string {
  const token = BigInt(input.tokenAmount);
  const quote = BigInt(input.quoteAmount);
  const fee = BigInt(input.feeAmount);
  if (
    token <= 0n ||
    quote < 0n ||
    fee < 0n ||
    !Number.isInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 18 ||
    !Number.isInteger(input.quoteDecimals) ||
    input.quoteDecimals < 0 ||
    input.quoteDecimals > 18
  ) {
    throw new RangeError("Invalid trade amounts");
  }
  const net = input.side === "buy" ? quote - fee : quote + fee;
  if (net < 0n) {
    throw new RangeError("Invalid trade fee");
  }
  return ((net * 10n ** BigInt(18 + input.tokenDecimals - input.quoteDecimals)) / token).toString();
}

export function tokenFdvWad(priceWad: string, totalSupply: string, tokenDecimals: number): string {
  return ((BigInt(priceWad) * BigInt(totalSupply)) / 10n ** BigInt(tokenDecimals)).toString();
}

/** Use only with the launch's matching committed preset and an observed canonical state. */
export function tokenCurveMarket(terms: TokenReferenceEconomics, netSold: string) {
  const sold = BigInt(netSold);
  const sale = BigInt(terms.saleAllocation);
  const priceWad = curveMarginalPriceWad(
    {
      virtualTokenReserve: BigInt(terms.virtualTokenReserve),
      virtualQuoteReserve: BigInt(terms.virtualQuoteReserve),
      saleAllocation: sale,
    },
    sold,
    terms.quoteDecimals,
  ).toString();
  return {
    priceWad,
    fdvWad: tokenFdvWad(priceWad, terms.totalSupply, terms.tokenDecimals),
    remainingTokens: (sale - sold).toString(),
    progressBps: Number((sold * 10_000n) / sale),
  };
}

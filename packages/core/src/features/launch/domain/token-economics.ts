/** Informational reference profile only. It is not a published preset or launch grant. */
import { deriveCurveReserves, curveMarginalPriceWad, quoteInForTokensOut } from "./curve-math.js";

export interface TokenReferenceEconomics {
  version: 2;
  source: "reference";
  quoteSymbol: "AUSD";
  quoteAddress: string;
  quoteDecimals: 6;
  tokenDecimals: 18;
  totalSupply: string;
  saleAllocation: string;
  lpAllocation: string;
  salePercent: number;
  lpPercent: number;
  virtualTokenReserve: string;
  virtualQuoteReserve: string;
  initialPriceWad: string;
  finalPriceWad: string;
  initialFdvWad: string;
  finalFdvWad: string;
  netReserveAtCompletion: string;
  buyFeeBps: number;
  sellFeeBps: number;
  protocolShareBps: number;
  launchFee: string;
  dexStatus: "pending";
}

/** The host supplies reviewed asset metadata for its configured network. No provider read. */
export function tokenReferenceEconomics(quote: {
  address: string;
  decimals: number;
}): TokenReferenceEconomics {
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(quote.address) ||
    /^0x0{40}$/i.test(quote.address) ||
    quote.decimals !== 6
  ) {
    throw new RangeError("Unsupported reference quote asset");
  }
  const unit = 10n ** 18n;
  const total = 21_000_000n * unit;
  const config = deriveCurveReserves(16_800_000n * unit, 4_200_000n * unit, 32_000n * 10n ** 6n);
  const initialPrice = curveMarginalPriceWad(config, 0n, 6);
  const finalPrice = curveMarginalPriceWad(config, config.saleAllocation, 6);
  return {
    version: 2,
    source: "reference",
    quoteSymbol: "AUSD",
    quoteAddress: quote.address,
    quoteDecimals: 6,
    tokenDecimals: 18,
    totalSupply: total.toString(),
    saleAllocation: config.saleAllocation.toString(),
    lpAllocation: (total - config.saleAllocation).toString(),
    salePercent: 80,
    lpPercent: 20,
    virtualTokenReserve: config.virtualTokenReserve.toString(),
    virtualQuoteReserve: config.virtualQuoteReserve.toString(),
    initialPriceWad: initialPrice.toString(),
    finalPriceWad: finalPrice.toString(),
    initialFdvWad: ((initialPrice * total) / unit).toString(),
    finalFdvWad: ((finalPrice * total) / unit).toString(),
    netReserveAtCompletion: quoteInForTokensOut(config, 0n, config.saleAllocation).toString(),
    buyFeeBps: 100,
    sellFeeBps: 100,
    protocolShareBps: 5000,
    launchFee: "0",
    dexStatus: "pending",
  };
}

/** Read-only portfolio projections. Exact amounts; no admission, orders or paper balances. */
export interface DashboardMarketInput {
  id: number;
  symbol: string;
  priceDecimals: number;
  sizeDecimals: number;
  mark: number;
  prev: number;
  maxLeverage: number;
  maintenanceBps: number;
  openInterest: number | null;
  fundingRate: number | null;
  fundingIntervalSec: number | null;
}
export interface DashboardAccountInput {
  id: number;
  balance: string;
  locked: string;
  frozen: boolean;
}
export interface DashboardPositionInput {
  id: number;
  accountId: number;
  marketId: number;
  side: "long" | "short";
  size: number;
  entry: number;
  entryResidue?: number;
  collateral: string;
  leverage: number | null;
}
export interface DashboardPositionView {
  id: number;
  accountId: number;
  marketId: number;
  side: "long" | "short";
  leverage: number | null;
  symbol: string;
  quantity: string | null;
  entryPrice: string | null;
  markPrice: string | null;
  collateralAusd: string;
  notionalAusd: string | null;
  pricePnlAusd: string | null;
  collateralExhaustionPrice: string | null;
  priceBufferBps: string | null;
}
export interface DashboardStatsInput {
  accountId: number;
  realizedPnl: string;
  fees: string;
  volume: string;
}
export function dashboardDecimal(units: bigint, decimals = 6): string {
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units).toString().padStart(decimals + 1, "0");
  if (decimals === 0) {
    return sign + digits;
  }
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${sign}${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
function scaled(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid Perpl scaled value");
  }
  return BigInt(value);
}
function quote(price: bigint, size: bigint, market: DashboardMarketInput): bigint {
  return (price * size * 1_000_000n) / 10n ** BigInt(market.priceDecimals + market.sizeDecimals);
}
function ratioBps(numerator: bigint, denominator: bigint): string | null {
  return denominator > 0n ? dashboardDecimal((numerator * 1_000_000n) / denominator, 2) : null;
}
export function dashboardMarkets(markets: readonly DashboardMarketInput[]) {
  let total = 0n;
  let complete = true;
  const rows = markets.map((market) => {
    const mark = scaled(market.mark);
    const previous = scaled(market.prev);
    const oi =
      market.openInterest === null ? null : quote(mark, scaled(market.openInterest), market);
    if (oi === null) {
      complete = false;
    } else {
      total += oi;
    }
    return {
      id: market.id,
      symbol: market.symbol,
      price: dashboardDecimal(mark, market.priceDecimals),
      change24hBps: ratioBps(mark - previous, previous),
      openInterestAusd: oi === null ? null : dashboardDecimal(oi),
      fundingBps:
        market.fundingRate === null ? null : dashboardDecimal(BigInt(market.fundingRate), 2),
      fundingIntervalSec: market.fundingIntervalSec,
      maxLeverage: market.maxLeverage,
    };
  });
  return { markets: rows, totalOpenInterestAusd: complete ? dashboardDecimal(total) : null };
}
export function dashboardPortfolio(input: {
  accounts: readonly DashboardAccountInput[];
  positions: readonly DashboardPositionInput[];
  stats: readonly DashboardStatsInput[];
  markets: readonly DashboardMarketInput[];
}) {
  const ids = new Set(input.accounts.map((account) => account.id));
  let balance = 0n;
  let lockedOrders = 0n;
  for (const account of input.accounts) {
    const b = BigInt(account.balance);
    const locked = BigInt(account.locked);
    if (b < 0n || locked < 0n || locked > b) {
      throw new Error("Invalid Perpl account balance");
    }
    balance += b;
    lockedOrders += locked;
  }
  let collateral = 0n;
  let pnl = 0n;
  let grossExposure = 0n;
  let netExposure = 0n;
  let complete = true;
  const positions = input.positions.map((position): DashboardPositionView => {
    if (!ids.has(position.accountId)) {
      throw new Error("Position belongs to another account");
    }
    const identity = {
      id: position.id,
      accountId: position.accountId,
      marketId: position.marketId,
      side: position.side,
      leverage: position.leverage,
    };
    const c = BigInt(position.collateral);
    if (c < 0n) {
      throw new Error("Invalid Perpl collateral");
    }
    collateral += c;
    const market = input.markets.find((item) => item.id === position.marketId);
    const size = scaled(position.size);
    const residue = position.entryResidue ?? 0;
    if (!Number.isInteger(residue) || residue < 0 || residue > 65535) {
      throw new Error("Invalid Perpl entry residue");
    }
    let entry = scaled(position.entry) * 65536n;
    if (residue > 0) {
      if (position.side === "long") {
        entry -= 65536n;
      }
      entry += BigInt(residue);
    }
    if (entry < 0n) {
      throw new Error("Invalid Perpl entry price");
    }
    if (!market || market.mark <= 0) {
      complete = false;
      return {
        ...identity,
        symbol: market?.symbol ?? `Market ${position.marketId}`,
        quantity: null,
        entryPrice: null,
        markPrice: null,
        collateralAusd: dashboardDecimal(c),
        notionalAusd: null,
        pricePnlAusd: null,
        collateralExhaustionPrice: null,
        priceBufferBps: null,
      };
    }
    const mark = scaled(market.mark);
    const direction = position.side === "long" ? 1n : -1n;
    const notional = quote(mark, size, market);
    const pricePnl = (direction * quote(mark * 65536n - entry, size, market)) / 65536n;
    pnl += pricePnl;
    grossExposure += notional;
    netExposure += direction * notional;
    // Loss-equals-collateral threshold only. Funding, fees and venue maintenance can liquidate earlier.
    // Uses CURRENT collateral/remaining size; never infer it from the original leverage.
    const lossPrice =
      size > 0n
        ? (c * 65536n * 10n ** BigInt(market.priceDecimals + market.sizeDecimals)) /
          (size * 1_000_000n)
        : null;
    const threshold = lossPrice === null ? null : entry - direction * lossPrice;
    const liquidation = threshold === null ? null : threshold < 0n ? 0n : threshold;
    const distance =
      liquidation === null
        ? null
        : ratioBps(direction * (mark * 65536n - liquidation), mark * 65536n);
    return {
      ...identity,
      symbol: market.symbol,
      quantity: dashboardDecimal(size, market.sizeDecimals),
      entryPrice: dashboardDecimal(entry * 5n ** 16n, market.priceDecimals + 16),
      markPrice: dashboardDecimal(mark, market.priceDecimals),
      collateralAusd: dashboardDecimal(c),
      notionalAusd: dashboardDecimal(notional),
      pricePnlAusd: dashboardDecimal(pricePnl),
      collateralExhaustionPrice:
        liquidation === null
          ? null
          : dashboardDecimal(liquidation * 5n ** 16n, market.priceDecimals + 16),
      priceBufferBps: distance,
    };
  });
  const statsComplete = input.accounts.every((account) =>
    input.stats.some((stat) => stat.accountId === account.id),
  );
  const sumStat = (key: "realizedPnl" | "fees" | "volume") =>
    statsComplete
      ? dashboardDecimal(
          input.stats
            .filter((stat) => ids.has(stat.accountId))
            .reduce((total, stat) => total + BigInt(stat[key]), 0n),
        )
      : null;
  return {
    accountCount: input.accounts.length,
    frozen: input.accounts.some((account) => account.frozen),
    availableAusd: dashboardDecimal(balance - lockedOrders),
    lockedOrdersAusd: dashboardDecimal(lockedOrders),
    collateralAusd: dashboardDecimal(collateral),
    equityEstimateAusd: complete ? dashboardDecimal(balance + collateral + pnl) : null,
    pricePnlAusd: complete ? dashboardDecimal(pnl) : null,
    grossExposureAusd: complete ? dashboardDecimal(grossExposure) : null,
    netExposureAusd: complete ? dashboardDecimal(netExposure) : null,
    realizedPnlAusd: sumStat("realizedPnl"),
    feesAusd: sumStat("fees"),
    volumeAusd: sumStat("volume"),
    positions,
  };
}

/** Provider-independent financial read port; implementations own transport and validation. */
export interface DashboardReadProof {
  apiKey: string;
  timestamp: string;
  nonce: string;
  signature: string;
}
export interface DashboardWalletRead {
  wallet: string;
  walletProof: DashboardReadProof;
  positionsProof: DashboardReadProof;
}
export type DashboardMarketSnapshot = ReturnType<typeof dashboardMarkets> & {
  chainId: 10143;
  observedAt: string;
  serverTimeMs: number;
  stale: boolean;
};
export type DashboardPortfolioSnapshot = ReturnType<typeof dashboardPortfolio> & {
  wallet: string;
  source?: "onchain" | undefined;
  chainId: 10143;
  observedAt: string;
  marketObservedAt: string;
  block: number;
  stale: boolean;
};
export interface PerplDashboardData {
  markets(signal: AbortSignal): Promise<DashboardMarketSnapshot>;
  publicPortfolio(wallet: string, signal: AbortSignal): Promise<DashboardPortfolioSnapshot>;
  portfolio(input: DashboardWalletRead, signal: AbortSignal): Promise<DashboardPortfolioSnapshot>;
}

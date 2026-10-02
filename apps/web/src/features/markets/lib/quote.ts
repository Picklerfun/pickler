import type { HorizonDto, PerpMarketDto } from "@pickler/api-schema";

/**
 * What a ticket says about itself while it is being filled in.
 *
 * Nothing here is sent anywhere: this site's wallet connection does not sign, so this is the
 * arithmetic behind a preview and the copy that states it. It moves into core the day an order is
 * really placed, because then the same numbers decide money instead of describing it. The fee and
 * the margins it uses are the venue's own, carried by each market in `limits`.
 */

export type Side = "long" | "short";

/** The price a level away from the mark. */
export const levelPrice = (mark: number, level: number) => mark * (1 + level / 100);

/** Above the mark is a long, below it a short. */
export const levelSide = (level: number): Side => (level >= 0 ? "long" : "short");

/**
 * A level the market has never covered inside an hour is refused rather than sold. A reach nobody
 * has measured refuses nothing: a square is turned down on evidence, not on its absence.
 */
export const outOfReach = (
  market: Pick<PerpMarketDto, "hourlyReach">,
  level: number,
  horizon: HorizonDto,
) => horizon === "1H" && market.hourlyReach !== null && Math.abs(level) > market.hourlyReach;

/** The mark at which the position is liquidated, isolated margin and no additions. */
function liquidationPrice(
  mark: number,
  side: Side,
  leverage: number,
  maintenanceMargin: number,
): number {
  const distance = 1 / leverage - maintenanceMargin;
  return mark * (1 + (side === "long" ? -distance : distance));
}

interface Quote {
  side: Side;
  /** Price the take profit sits at. */
  target: number;
  /** Margin times leverage, in AUSD. */
  notional: number;
  /** Position size in the base asset. */
  size: number;
  liquidation: number;
  /** The taker fee of the open, in AUSD. The venue charges the close as well; that is not in here. */
  fee: number;
  /** What the position returns in AUSD if the mark reaches the level. */
  winIfHit: number;
  /** Margin plus the fee: what the account needs for this ticket. */
  required: number;
}

/** The level decides the side, so a quote can never disagree with the square it came from. */
export function quoteTicket(input: {
  market: Pick<PerpMarketDto, "mark" | "maxLeverage" | "limits">;
  level: number;
  margin: number;
  leverage: number;
}): Quote {
  const side = levelSide(input.level);
  // Never below one: a market whose ceiling is under 1× would divide the margin by zero.
  const leverage = Math.max(1, Math.min(input.leverage, input.market.maxLeverage));
  const margin = Math.max(input.margin, 0);
  const notional = margin * leverage;
  const fee = notional * input.market.limits.takerFee;

  return {
    side,
    target: levelPrice(input.market.mark, input.level),
    notional,
    size: input.market.mark > 0 ? notional / input.market.mark : 0,
    liquidation: liquidationPrice(
      input.market.mark,
      side,
      leverage,
      input.market.limits.maintenanceMargin,
    ),
    fee,
    winIfHit: (Math.abs(input.level) / 100) * notional,
    required: margin + fee,
  };
}

/** When a square taken now closes, whether or not it reached its level. */
export function closesAt(nowMs: number, horizon: HorizonDto): Date {
  return new Date(nowMs + Number.parseInt(horizon, 10) * 60 * 60 * 1000);
}

/** The position in one line, the way the ticket and the review both say it. */
export const positionPhrase = (
  symbol: string,
  side: Side,
  targetLabel: string,
  horizon: HorizonDto,
) => `${side === "long" ? "Long" : "Short"} ${symbol} to ${targetLabel} within ${horizon}`;

/** The trigger that closes the position in profit, as Perpl would hold it. */
export const triggerRule = (side: Side, targetLabel: string) =>
  side === "long" ? `MARK ≥ ${targetLabel}` : `MARK ≤ ${targetLabel}`;

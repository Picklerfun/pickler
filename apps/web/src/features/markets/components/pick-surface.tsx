"use client";

import type { HorizonDto, MarketDetailDto } from "@pickler/api-schema";
import { HORIZON_OPTIONS, LEVEL_OPTIONS, READ_HORIZON_DTO } from "@pickler/api-schema";
import styles from "../markets.module.css";
import { formatColumnTime, formatLevel, formatPrice } from "../lib/format";
import { closesAt, levelPrice, levelSide, outOfReach } from "../lib/ticket";

export interface Square {
  level: number;
  horizon: HorizonDto;
}

/** Why a square cannot be taken. `later` is Ask asking over a horizon reads do not run on. */
export type SquareBlock = "reach" | "later";

export function squareBlock(
  market: MarketDetailDto["market"],
  square: Square,
  mode: "trade" | "ask",
): SquareBlock | null {
  if (mode === "ask" && square.horizon !== READ_HORIZON_DTO) {
    return "later";
  }
  return outOfReach(market, square.level, square.horizon) ? "reach" : null;
}

interface SurfaceProps {
  detail: MarketDetailDto;
  mode: "trade" | "ask";
  selection: Square | null;
  /** True once the ticket is past editing, so the surface reads rather than takes clicks. */
  locked: boolean;
  now: number;
  onPick: (square: Square) => void;
  onBlocked: (square: Square, block: SquareBlock) => void;
}

/**
 * The surface: price levels down the side, time across the bottom, one square where they meet.
 *
 * Under Trade a square is a position — above the mark a long, below it a short — and the column is
 * how long it is given. Under Ask the same square is a question, and only the 24-hour column takes
 * one, because a read is only comparable with another read asked over the same distance.
 */
export function PickSurface({
  detail,
  mode,
  selection,
  locked,
  now,
  onPick,
  onBlocked,
}: SurfaceProps) {
  const { market, calls } = detail;
  const asking = mode === "ask";
  const side = selection ? levelSide(selection.level) : null;

  const tone = asking ? styles.toneAsk : side === "short" ? styles.toneShort : styles.toneLong;

  return (
    <section className={`${styles.surface} ${tone}`} aria-label="Level and time">
      <header className={styles.surfaceHead}>
        <p className={styles.microLabel}>
          LEVEL × TIME · <span className={styles.surfaceMode}>{asking ? "ASK" : "TRADE"}</span>
        </p>
        <p className={styles.microLabel}>
          {locked ? "THE TICKET IS PAST EDITING" : "CLICK A SQUARE"}
        </p>
      </header>

      <div className={styles.surfaceBody}>
        <div className={styles.rails} aria-hidden="true">
          <span className={`${styles.rail} ${styles.railLong}`}>UP · LONG</span>
          <span className={`${styles.rail} ${styles.railShort}`}>DOWN · SHORT</span>
        </div>

        <div className={styles.trail} aria-hidden="true">
          <Trail marks={detail.trail} mark={market.mark} />
          <span className={styles.trailLabel}>LAST 24H · MARK</span>
        </div>

        <div className={styles.rows}>
          {LEVEL_OPTIONS.map((level, index) => (
            <div key={level}>
              {index === LEVEL_OPTIONS.findIndex((step) => step < 0) && (
                <p className={styles.markRow}>
                  <span className={styles.markPrice}>{formatPrice(market.mark)}</span>
                  <span className={styles.microLabel}>MARK · NOW</span>
                </p>
              )}

              <div className={styles.row}>
                <span
                  className={`${styles.rowLevel} ${selection?.level === level ? styles.rowLevelOn : ""}`}
                >
                  <span className={styles.rowPrice}>
                    {formatPrice(levelPrice(market.mark, level))}
                  </span>
                  <span className={styles.rowPct}>{formatLevel(level)}</span>
                </span>

                {HORIZON_OPTIONS.map((horizon) => {
                  const square = { level, horizon };
                  const block = squareBlock(market, square, mode);
                  const on = selection?.level === level && selection.horizon === horizon;
                  const lit = !on && (selection?.level === level || selection?.horizon === horizon);
                  const dots = calls.find(
                    (call) => call.level === level && call.horizon === horizon,
                  );

                  return (
                    <button
                      key={horizon}
                      type="button"
                      className={styles.cell}
                      data-on={on || undefined}
                      data-lit={lit || undefined}
                      data-blocked={block ?? undefined}
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => (block ? onBlocked(square, block) : onPick(square))}
                      aria-label={squareLabel(market.symbol, level, horizon, asking, market.mark)}
                    >
                      {on ? (
                        <span className={styles.cellPill}>
                          {asking ? "ASK" : levelSide(level) === "long" ? "LONG" : "SHORT"}
                        </span>
                      ) : (
                        <span
                          className={styles.cellDot}
                          data-call={dots ? true : undefined}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className={styles.columns}>
            <span className={styles.rowLevel}>{asking ? "RESOLVES AT" : "CLOSES BY"}</span>
            {HORIZON_OPTIONS.map((horizon) => (
              <span
                key={horizon}
                className={styles.column}
                data-on={selection?.horizon === horizon || undefined}
                data-off={(asking && horizon !== READ_HORIZON_DTO) || undefined}
              >
                <span className={styles.columnLabel}>{horizon}</span>
                <span className={styles.columnTime}>
                  {formatColumnTime(closesAt(now, horizon), new Date(now))}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function squareLabel(
  symbol: string,
  level: number,
  horizon: HorizonDto,
  asking: boolean,
  mark: number,
): string {
  const price = formatPrice(levelPrice(mark, level));
  if (asking) {
    return `Ask whether ${symbol} is above ${price} in ${horizon}`;
  }
  return `${levelSide(level) === "long" ? "Long" : "Short"} ${symbol} to ${price} within ${horizon}`;
}

/**
 * The last day of marks beside the levels.
 *
 * It is drawn on the surface's own scale — top level to bottom level — rather than on its own
 * minimum and maximum, so a quiet day looks quiet and the line sits at the height of the price it
 * is showing. The rows are the reason the column is here at all.
 */
function Trail({ marks, mark }: { marks: number[]; mark: number }) {
  if (marks.length < 2) {
    return null;
  }

  const top = levelPrice(mark, LEVEL_OPTIONS[0]!);
  const bottom = levelPrice(mark, LEVEL_OPTIONS[LEVEL_OPTIONS.length - 1]!);
  const span = top - bottom || 1;
  const points = marks
    .map((value, index) => {
      const x = (index / (marks.length - 1)) * 100;
      const y = Math.min(98, Math.max(2, ((top - value) / span) * 100));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.trailLine}>
      <polyline points={points} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

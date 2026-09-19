"use client";

import type { AgentProfileDto, ChartRangeDto } from "@pickler/api-schema";
import { CandleChart, Chip } from "@pickler/ui";
import { useState } from "react";
import styles from "../agents.module.css";
import { formatChange } from "../lib/format";

const RANGES: ChartRangeDto[] = ["5m", "1h", "4h", "1d"];
type Candles = NonNullable<AgentProfileDto["market"]>["candles"];

/** Price history for the token, headed by what the board shows: market cap, change and volume. */
export function PriceChart({
  price,
  change24h,
  candles,
  marketCap,
  volume24h,
}: {
  price: number;
  change24h: number;
  candles: Candles;
  marketCap: string;
  volume24h: string;
}) {
  const [range, setRange] = useState<ChartRangeDto>("1h");
  const series = candles[range];
  // Tiny prices need more decimals than a graduated pair does.
  const precision = price < 0.01 ? 6 : 4;

  return (
    <>
      <div className={styles.panelHead}>
        <span className={styles.label}>MCAP</span>
        <span className={styles.panelHeadValue}>{marketCap}</span>
        <span
          className={`${styles.change} ${change24h < 0 ? styles.toneLoss : styles.toneWin}`}
          style={{ margin: 0 }}
        >
          {formatChange(change24h)}
        </span>
        <span className={styles.label}>VOL 24H</span>
        <span className={styles.panelHeadValue}>{volume24h}</span>
        <span className={styles.ranges} role="group" aria-label="Chart range">
          {RANGES.map((option) => (
            <Chip
              key={option}
              className={styles.rangeButton}
              selected={option === range}
              onClick={() => setRange(option)}
            >
              {option.toUpperCase()}
            </Chip>
          ))}
        </span>
      </div>
      <div className={styles.chartFrame}>
        {series.length === 0 ? (
          <p className={styles.chartEmpty}>No trades in this range yet.</p>
        ) : (
          <CandleChart
            candles={series.map((candle) => ({ ...candle, at: Date.parse(candle.at) }))}
            precision={precision}
            label={`${range} price candles`}
          />
        )}
      </div>
    </>
  );
}

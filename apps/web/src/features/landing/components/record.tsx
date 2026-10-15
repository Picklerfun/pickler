"use client";

import { useEffect, useState } from "react";
import styles from "../landing.module.css";
import {
  advanceRecord,
  RECORD_FLASH_MS,
  RECORD_SEED,
  RECORD_TICK_MS,
  type Drop,
} from "../lib/demo";
import { useTicker } from "../lib/use-ticker";

/**
 * The record, as a candle game: agents call where price ends, above or below the line, a column
 * of cells per call. The board fills, the candle closes, "SETTLED" flashes and the board clears.
 * The sequence is `advanceRecord`; this owns the clock and the flash.
 */
export function Record() {
  const [state, setState] = useState(RECORD_SEED);
  useTicker(RECORD_TICK_MS, () => setState(advanceRecord));

  useEffect(() => {
    if (!state.clearing) {
      return;
    }
    const timer = setTimeout(() => setState((s) => ({ ...s, clearing: false })), RECORD_FLASH_MS);
    return () => clearTimeout(timer);
  }, [state.clearing]);

  return (
    <article id="bento-record" className={`${styles.bentoCard} ${styles.bentoRecord}`}>
      <p className={styles.cardTitle}>Above or below. Called before the candle closes.</p>
      <p className={styles.cardNote}>
        Agents call where price ends. The candle settles it, in public, and the result stays on
        their record.
      </p>
      <div className={styles.chart} aria-hidden="true">
        <span className={styles.chartLine} />
        <span className={styles.chartPrice}>BTC 64,120</span>
        <span className={styles.chartSpacer} />
        {state.clearing && (
          <div className={styles.chartFlash}>
            <span className={styles.chartFlashText}>CANDLE CLOSED · SETTLED</span>
          </div>
        )}
        {state.stack.map((drop, index) => (
          <Column key={`${state.cursor}-${index}`} drop={drop} />
        ))}
      </div>
    </article>
  );
}

function Column({ drop }: { drop: Drop }) {
  const tone = drop.outcome === "open" ? "open" : drop.side;
  const cells = Array.from({ length: drop.cells }, (_, i) => (
    <span key={i} className={styles.cell} data-tone={tone} />
  ));
  const figure = (
    <>
      <span className={styles.colTicker}>{drop.ticker}</span>
      <span className={styles.colMeta} data-outcome={drop.outcome}>
        {drop.meta}
      </span>
    </>
  );
  return (
    <div className={styles.col}>
      <div className={`${styles.colHalf} ${styles.colTop}`}>
        {drop.side === "up" ? (
          <>
            <span className={styles.stem} data-tone={tone} />
            {cells}
          </>
        ) : (
          figure
        )}
      </div>
      <div className={`${styles.colHalf} ${styles.colBottom}`}>
        {drop.side === "down" ? (
          <>
            {cells}
            <span className={styles.stem} data-tone={tone} />
          </>
        ) : (
          figure
        )}
      </div>
    </div>
  );
}

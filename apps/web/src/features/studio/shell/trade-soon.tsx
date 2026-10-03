"use client";
import type { StudioIdPrefix } from "./model";
import styles from "./cards.module.css";

/**
 * Trade (draft spec D16; studio-live-v1 L20): the canvas's YOU TRADE · PERPL card as a Soon panel,
 * the same in both studios. Trading from the master wallet needs live Perpl (`perpl-live-v1.md`),
 * so no market, size or button is drawn; `note` says what it waits for. The section's frame is the
 * studio's own.
 */
export function TradeSoon({
  idPrefix,
  note,
}: {
  /** `draft` or `live`: the card is `#<idPrefix>-trade-soon`. */
  idPrefix: StudioIdPrefix;
  /** The card's one line. It may not promise what the Perpl runtime will do (draft spec D19). */
  note: string;
}) {
  return (
    <div className={styles.tradeSoon} id={`${idPrefix}-trade-soon`}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>YOU TRADE · PERPL</h3>
        <span className={styles.headSoon}>SOON</span>
      </div>
      <p className={styles.cardNote}>{note}</p>
    </div>
  );
}

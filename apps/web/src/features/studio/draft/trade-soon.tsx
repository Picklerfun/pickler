"use client";
import { DraftSection, type DraftSectionProps } from "./section";
import styles from "./run.module.css";

/**
 * Trade (spec D16): the canvas's YOU TRADE · PERPL card as a Soon panel. Trading from the master
 * wallet needs live Perpl (`perpl-live-v1.md`), so no market, size or button is drawn.
 */
export function TradeSoon(props: DraftSectionProps) {
  void props;
  return (
    <DraftSection section="trade">
      <div className={styles.tradeSoon} id="draft-trade-soon">
        <div className={styles.cardHead}>
          <h3 className={styles.cardLabel}>YOU TRADE · PERPL</h3>
          <span className={styles.headSoon}>SOON</span>
        </div>
        <p className={styles.cardNote}>
          Trading from your master wallet opens with live Perpl trading.
        </p>
      </div>
    </DraftSection>
  );
}

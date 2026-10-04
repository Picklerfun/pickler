"use client";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import { tradeCount, tradeRows, tradesNote } from "./runtime-model";
import styles from "./run.module.css";

/**
 * Trades (canvas 639–674, spec §3.4): the paper positions its runs opened
 * (`GET /perps/positions`, perpl-paper-runtime-v1 R17), open first, then closed, each with its
 * P&L. None yet is the empty state and the way to the Console; while the Perpl runtime is off it
 * says paper runs are still to open (D12), or, once it has a paper account, that checks are paused
 * while exits still run (`tradesNote`). Reviewing its calls is not built, so nothing says it
 * learns from you (D19).
 */
export function Trades({ draft, onSection }: DraftSectionProps) {
  const rows = tradeRows(draft.positions);
  return (
    <DraftSection section="picks">
      <div className={styles.trades}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>Paper trades</h3>
          <span className={styles.listMeta}>{tradeCount(draft.positions)}</span>
        </div>
        <p className={styles.cardNote}>{tradesNote(draft.record)}</p>
        {rows.length === 0 ? (
          <div className={styles.empty}>
            <span>
              No paper trades yet. Run it from the Console and every decision lands here, with what
              fired and what held.
            </span>
            <button
              type="button"
              className={styles.whiteButton}
              onClick={() => onSection("console")}
            >
              Open Console
            </button>
          </div>
        ) : (
          <ul className={styles.tradeList} id="draft-trades-list">
            {rows.map((row) => (
              <li key={row.id} className={styles.trade}>
                <div className={styles.tradeHead}>
                  <span className={styles.tradeDot} data-state={row.state} aria-hidden="true" />
                  <span className={styles.tradeText}>
                    <span className={styles.tradeTitle}>{row.title}</span>
                    <span className={styles.tradeMeta}>{row.meta}</span>
                  </span>
                  <span className={styles.tradeState}>PAPER · {row.state}</span>
                </div>
                <div className={styles.tradeFoot}>
                  <span className={styles.tradePnl} data-tone={row.pnl.tone}>
                    {row.pnl.text}
                  </span>
                  {/* Local time: the server's zone may differ from the browser's. */}
                  <time className={styles.tradeAt} dateTime={row.iso} suppressHydrationWarning>
                    {row.at}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DraftSection>
  );
}

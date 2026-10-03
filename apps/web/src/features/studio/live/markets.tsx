"use client";
import { useState, type ReactElement } from "react";
import { Chip } from "@pickler/ui";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { READ_WORDS, SHUT, readState } from "./market-model";
import { ReadNote, Shut } from "./market-parts";
import { boardHeader, boardRows } from "./model";
import styles from "./market.module.css";

/**
 * Marketplace · Markets (canvas 645–672, spec L18): the real board, the same read WHAT IT WATCHES
 * draws. Category filters derived from the board, "PERPL · FROM MASTER · {AUSD} AUSD", the SAMPLE
 * DATA / STALE tag (L8), and one card per market: symbol, pair, max leverage, agents reading ("—"
 * when nobody counted), mark, 24 h change and the venue's note. "Ask" and "Trade" are shut with
 * Soon: paid reads and trading from the master wallet are not built.
 */
export const Markets: (props: LiveSectionProps) => ReactElement = ({ live }) => {
  const [category, setCategory] = useState("All");
  const state = readState(live.markets, live.preview, (list) => list.length === 0);
  const view = Array.isArray(live.markets) ? boardRows(live.markets, category) : null;

  return (
    <LiveSection section="markets">
      <div className={styles.stack} id="live-markets" data-state={state}>
        <div className={styles.filters} role="group" aria-label="Categories">
          {state === "ready" &&
            view?.filters.map((filter) => (
              <Chip key={filter.key} selected={filter.on} onClick={() => setCategory(filter.key)}>
                {filter.label}
                <span className={styles.count}>{filter.count}</span>
              </Chip>
            ))}
          {view?.tag && <span className={styles.sourceTag}>{view.tag}</span>}
          <span className={styles.filterTag}>{boardHeader(live.wallets)}</span>
        </div>

        {state !== "ready" && (
          <ReadNote state={state} words={READ_WORDS.markets} onRetry={live.readMarkets} />
        )}

        {state === "ready" && view && (
          <ul className={styles.cards}>
            {view.rows.map((row) => (
              <li key={row.key} className={styles.marketCard}>
                <div className={styles.agentHead}>
                  <span className={styles.symbol} aria-hidden="true">
                    {row.base}
                  </span>
                  <span className={styles.who}>
                    <span className={styles.name}>{row.pair}</span>
                    <span className={styles.sub}>
                      MAX {row.maxLeverage} · {row.agents}
                    </span>
                  </span>
                  <span className={styles.mark}>
                    <span className={styles.markValue}>{row.mark}</span>
                    <span className={styles.change} data-up={row.up}>
                      {row.change} · 24H
                    </span>
                  </span>
                </div>
                <div className={styles.marketFoot}>
                  <span className={styles.marketNote}>{row.note}</span>
                  <Shut tone="ask" size="small" label="Ask" reason={SHUT.ask} />
                  <Shut size="small" label="Trade" reason={SHUT.trade} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LiveSection>
  );
};

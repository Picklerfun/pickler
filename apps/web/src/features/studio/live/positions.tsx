"use client";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { FUNDING_LABEL, MARKETS_FAILED_LINE, marketsView } from "./model";
import {
  FLAT_LINE,
  OPEN_COUNT,
  WATCH_META,
  WATCH_NONE,
  trailText,
  watchLoading,
} from "./run-model";
import { PositionCards } from "./runtime-parts";
import { runtimeOn } from "./runtime-model";
import { Sparkline } from "./sparkline";
import styles from "./run.module.css";

/**
 * Its positions, as Overview and Positions both draw them (canvas 205–219, 228–230): the head and,
 * until the Perpl runtime opens one, the flat line (spec L7). `children` sits under the line.
 */
export function FlatPositions({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.list} id={id}>
      <div className={styles.listHead}>
        <h3 className={styles.listTitle}>{title}</h3>
        <span className={styles.listMeta}>{OPEN_COUNT}</span>
      </div>
      <div className={styles.empty}>{FLAT_LINE}</div>
      {children}
    </div>
  );
}

/**
 * WHAT IT WATCHES (spec L8): the real board for the markets in its setup: mark, 24 h change, the
 * hourly funding and a sparkline of the trail, tagged SAMPLE DATA or STALE when the board is
 * either, "Reading Perpl…" before the read, and "Couldn't read Perpl." with Retry when it failed.
 */
function WhatItWatches({ agent, live }: Pick<LiveSectionProps, "agent" | "live">) {
  const [retrying, setRetrying] = useState(false);
  const view = marketsView(live.markets, live.details, agent.config.perpl?.markets ?? []);
  /* Retry unmounts with the failure it answers: once the read leaves `failed`, the heading takes
     focus so it does not drop to the page. */
  const heading = useRef<HTMLHeadingElement>(null);
  const retried = useRef(false);

  useEffect(() => {
    if (retried.current && view.state !== "failed") {
      retried.current = false;
      heading.current?.focus();
    }
  }, [view.state]);

  async function retry() {
    if (retrying) {
      return;
    }
    retried.current = true;
    setRetrying(true);
    try {
      await live.readMarkets();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className={styles.watch} id="live-positions-watch" data-state={view.state}>
      <div className={styles.watchHead}>
        <h4 className={styles.watchLabel} ref={heading} tabIndex={-1}>
          WHAT IT WATCHES
        </h4>
        {view.tag && <span className={styles.sourceTag}>{view.tag}</span>}
        <span className={styles.watchMeta}>{WATCH_META}</span>
      </div>

      {view.state === "loading" && (
        <p className={styles.watchState} role="status">
          {watchLoading(live.preview)}
        </p>
      )}

      {view.state === "failed" && (
        <div className={styles.watchState} role="alert">
          <span>{MARKETS_FAILED_LINE}</span>
          <button
            type="button"
            className={styles.retry}
            aria-disabled={retrying || undefined}
            onClick={() => void retry()}
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {view.state === "ready" && view.cards.length === 0 && (
        <p className={styles.watchState}>{WATCH_NONE}</p>
      )}

      {view.state === "ready" && view.cards.length > 0 && (
        <ul className={styles.watchRows}>
          {view.cards.map((card) => (
            <li key={card.key} className={styles.watchRow}>
              <span className={styles.watchName}>
                <span className={styles.marketName}>{card.name}</span>
                <span className={styles.funding}>
                  {FUNDING_LABEL} {card.funding}
                </span>
              </span>
              <Sparkline trail={card.trail} up={card.up} />
              <span className={styles.srOnly}>
                {card.listed ? trailText(card.trail) : "Not on the board."}
              </span>
              <span className={styles.watchMark}>
                <span className={styles.mark}>{card.mark}</span>
                <span className={styles.change} data-up={card.up ?? undefined}>
                  {card.change}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Positions (canvas 225–262, spec L7, L8). With the Perpl runtime off: flat, and under the line
 * WHAT IT WATCHES. With it on: the open paper positions as the canvas's full cards (what it put
 * in, the notional, what it is worth, the stop–target meter, the time stop, entry, mark and
 * liquidation, Close now and "Why this trade", which opens Decisions on the check that opened it),
 * then WHAT IT WATCHES.
 */
export const Positions: (props: LiveSectionProps) => ReactElement = ({
  agent,
  live,
  now,
  canManage,
  onWhy,
}) => (
  <LiveSection section="positions">
    <div className={styles.run}>
      {runtimeOn(live.record) ? (
        <>
          <PositionCards
            id="live-positions-open"
            title="Open"
            live={live}
            now={now}
            canManage={canManage}
            full
            paused={agent.paused}
            onWhy={onWhy}
          />
          <WhatItWatches agent={agent} live={live} />
        </>
      ) : (
        <FlatPositions id="live-positions-open" title="Open">
          <WhatItWatches agent={agent} live={live} />
        </FlatPositions>
      )}
    </div>
  </LiveSection>
);

"use client";
import { Segmented, Skeleton } from "@pickler/ui";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { FUNDING_LABEL, MARKETS_FAILED_LINE, marketsView } from "./model";
import {
  FLAT_LINE,
  OPEN_COUNT,
  PRICE_RANGES,
  WATCH_NONE,
  priceTime,
  rangeTrail,
  trailText,
  type PriceRange,
} from "./run-model";
import { PositionCards } from "./runtime-parts";
import { paperShown } from "./runtime-model";
import { PriceTrail } from "./sparkline";
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
 * either, Skeletons before the read, and "Couldn't read Perpl." with Retry when it failed.
 */
function WhatItWatches({ agent, live }: Pick<LiveSectionProps, "agent" | "live">) {
  const [retrying, setRetrying] = useState(false);
  const [range, setRange] = useState<PriceRange>("24H");
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
        <span className={styles.watchControls}>
          <span className={styles.watchMeta}>PERPL</span>
          <Segmented
            label="Price history range"
            options={PRICE_RANGES}
            value={range}
            onChange={setRange}
            className={styles.watchRanges}
            optionClassName={styles.watchRange}
          />
        </span>
      </div>

      {view.state === "loading" && (
        <div
          className={styles.watchSkeleton}
          role="status"
          aria-label="Loading markets"
          aria-busy="true"
        >
          <Skeleton shape="panel" />
          <Skeleton shape="panel" />
        </div>
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
          {view.cards.map((card) => {
            const updated = priceTime(card.observedAt);
            const visible = rangeTrail(card.priceHistory, card.trail, card.trailTimestamps, range);
            const since = priceTime(visible.since);
            return (
              <li key={card.key} className={styles.watchRow}>
                <span className={styles.watchName}>
                  <span className={styles.marketName}>{card.name}</span>
                  <span className={styles.funding}>
                    {FUNDING_LABEL} {card.funding}
                  </span>
                </span>
                <div className={styles.watchChart}>
                  <PriceTrail
                    trail={visible.trail}
                    timestamps={visible.timestamps}
                    market={card.name}
                    range={range}
                  />
                  {since && (
                    <span className={styles.historySince}>History since {since.label}</span>
                  )}
                </div>
                <span className={styles.srOnly}>
                  {card.listed ? trailText(visible.trail, range) : "Not on the board."}
                </span>
                <span className={styles.watchMark}>
                  <span className={styles.mark}>{card.mark}</span>
                  <span className={styles.change} data-up={card.up ?? undefined}>
                    {card.change} <span className={styles.changePeriod}>24h</span>
                  </span>
                  {updated && (
                    <time
                      className={styles.priceUpdated}
                      dateTime={updated.iso}
                      title={updated.label}
                    >
                      {card.stale ? "Last read" : "Updated"} {updated.clock}
                    </time>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Positions (canvas 225–262, spec L7, L8). With the Perpl runtime off and no paper account: flat,
 * and under the line WHAT IT WATCHES. With it on, or off with a paper account (its positions still
 * exit and close; a line says checks are paused): the open paper positions as the canvas's full cards (what it put
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
      {paperShown(live.record) ? (
        <>
          <PositionCards
            id="live-positions-open"
            title="Open"
            live={live}
            now={now}
            canManage={canManage}
            full
            paused={agent.paused}
            running={live.record.runtimeEnabled}
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

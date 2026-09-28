"use client";
import { Button, Icon, Tag } from "@pickler/ui";
import type { HomeStatus, PickCard } from "./status";
import styles from "./home.module.css";

const pct = (value: number) => `${Math.min(100, Math.max(0, value * 100))}%`;

/** The range bar: the band it believes, its estimate, and the market as a diamond. */
function RangeBar({
  range,
  estimate,
  market,
}: {
  range: { lower: number; upper: number };
  estimate?: number | undefined;
  market?: number | null | undefined;
}) {
  return (
    <div className={styles.rangeBar} aria-hidden="true">
      <span className={styles.rangeTrack} />
      <span
        className={styles.rangeBand}
        style={{ left: pct(range.lower), width: pct(range.upper - range.lower) }}
      />
      {estimate !== undefined && (
        <span className={styles.rangeEstimate} style={{ left: pct(estimate) }} />
      )}
      {market !== undefined && market !== null && (
        <span className={styles.rangeMarket} style={{ left: pct(market) }} />
      )}
    </div>
  );
}

/**
 * Picks: empty until the run chooses a market, then what it is looking at (the range forming), then
 * the call — range, market, the reason, its paper order and "Full reasoning →" to the pick detail.
 */
export function Picks({
  status,
  card,
  runId,
  calls,
  orderError,
  onOpen,
}: {
  status: HomeStatus;
  card: PickCard | null;
  runId: string | null;
  /** How many of its runs ended in a decision. */
  calls: number;
  orderError: string;
  onOpen(runId: string): void;
}) {
  return (
    <section className={styles.column} id="home-picks" aria-label="Picks">
      <div className={styles.colBar}>
        <h2 className={styles.colHead}>Picks</h2>
        {calls > 0 && (
          <span className={styles.colCount}>
            {calls} {calls === 1 ? "CALL" : "CALLS"}
          </span>
        )}
      </div>

      {status.picks === "empty" && (
        <p className={styles.empty}>
          Its first call lands here. Every pick and every pass stays on the record.
        </p>
      )}

      {status.picks === "looking" && (
        <div className={styles.looking}>
          <p className={styles.lookingLabel}>
            <span className={styles.blinkDot} />
            LOOKING AT
          </p>
          <p className={styles.pickTitle}>{status.market?.question ?? "The market it chose"}</p>
          {status.range ? (
            <RangeBar range={status.range} />
          ) : (
            <div className={styles.rangeBar} aria-hidden="true">
              <span className={styles.rangeTrack} />
            </div>
          )}
          <p className={styles.pickSub}>{status.lookingNote}</p>
        </div>
      )}

      {status.picks === "done" && card && (
        <div className={styles.pick}>
          <div className={styles.pickHead}>
            <span className={styles.grow}>
              <span className={styles.pickTitle}>{card.title}</span>
              <span className={styles.pickSub}>{card.sub}</span>
            </span>
            <Tag className={styles.actionTag} data-action={card.action}>
              {card.action}
            </Tag>
          </div>
          {card.range && (
            <RangeBar range={card.range} estimate={card.range.estimate} market={card.market} />
          )}
          <p className={styles.figures}>
            <span>
              <em data-tint="violet">Range</em> {card.rangeText}
            </span>
            <span>
              <em data-tint="lime">Market</em> {card.marketText}
            </span>
          </p>
          <p className={styles.reason}>{card.reason}</p>
          <div className={styles.pickFoot}>
            {card.paper && (
              <span className={styles.paper}>
                <span className={styles.paperDot} />
                {card.paper}
              </span>
            )}
            {runId && (
              <Button
                variant="ghost"
                size="sm"
                className={styles.reasoning}
                arrow
                onClick={() => onOpen(runId)}
              >
                Full reasoning
              </Button>
            )}
          </div>
          {orderError && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={13} />
              {orderError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

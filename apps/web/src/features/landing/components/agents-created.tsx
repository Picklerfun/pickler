"use client";

import styles from "../landing.module.css";
import { formatAgo, formatInteger } from "../lib/format";
import { useLanding } from "../lib/landing-data";
import { PALETTE, hueOf } from "../lib/palette";
import { Mark } from "./mark";

const CELLS = 21;
const JUST_SPAWNED_MS = 10 * 60_000;

/**
 * How many agents exist, how many arrived today, and which one arrived last.
 *
 * Every figure here is the snapshot's own. The canvas ticks the count up on an interval, and
 * nothing behind this page produces a new agent every few seconds — a number that climbs against a
 * fixed snapshot is a claim the product cannot back. So the count is what the API said, and it
 * moves when the API says something else, which `LandingDataProvider` asks it every thirty seconds.
 *
 * The grid is a unit chart of today's arrivals, one square each, and the last lit square pops when
 * the count actually changes rather than on a timer. Past twenty-one squares the grid is full and
 * the label carries the real number.
 */
export function AgentsCreated() {
  const { data, nowMs } = useLanding();
  const { spawns, stats } = data;

  const today = Math.max(0, stats.agentsCreatedToday);
  const lit = Math.min(CELLS, today);
  const newest = [...spawns].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

  return (
    <section className={styles.created} aria-label="Agents created">
      <div className={styles.labelRow}>
        <span className={styles.liveDot} aria-hidden="true" />
        <p className={styles.label}>AGENTS CREATED</p>
      </div>
      <p className={styles.bigCount}>{formatInteger(stats.agentsCreated)}</p>
      <div
        className={styles.cellGrid}
        role="img"
        aria-label={`${formatInteger(today)} created in the last 24 hours`}
      >
        {Array.from({ length: CELLS }, (_, i) => {
          if (i >= lit) {
            return <span key={i} className={`${styles.cell} ${styles.cellOff}`} />;
          }
          const fresh = i === lit - 1;
          return (
            <Mark
              // Re-keying the newest square on a change in the count is what replays its pop, so it
              // plays when an agent is actually created and not once a second regardless.
              key={fresh ? `fresh-${lit}` : i}
              hue={PALETTE[i % PALETTE.length]!}
              className={`${styles.cell} ${fresh ? styles.cellFresh : ""}`}
            />
          );
        })}
      </div>
      {newest && (
        <p className={styles.spawn}>
          <Mark hue={hueOf(newest.accent)} className={styles.spawnMark} />
          <span className={styles.spawnName}>{newest.name}</span>
          <span className={styles.spawnNote}>
            {nowMs - Date.parse(newest.createdAt) < JUST_SPAWNED_MS
              ? "just spawned"
              : `spawned ${formatAgo(newest.createdAt, nowMs)}`}
          </span>
        </p>
      )}
    </section>
  );
}

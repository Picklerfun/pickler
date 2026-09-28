"use client";

import styles from "../landing.module.css";
import { formatInteger } from "../lib/format";
import { useLanding } from "../lib/landing-data";
import { hueOf } from "../lib/palette";
import { Mark } from "./mark";

/**
 * What backers have put behind agents, and the last few deposits that did it.
 *
 * One row per real deposit, oldest at the bottom, each row as many blocks wide as the agent's mark.
 * They drop in once, on arrival, and then stay: the canvas loops the well forever and clears it
 * when it fills, and against a list of six deposits that loop would be the same six falling over
 * and over as though money were still arriving. An entrance shows real deposits; a loop invents
 * them. So there is no loop and no line clear — the well holds what was actually deposited.
 *
 * The figure is `backing.fundedTotal`, which is a total and not a day's worth, so the label says
 * BACKED rather than the canvas's BACKED TODAY. Nothing in the snapshot is scoped to today.
 */
export function Backed() {
  const { backing } = useLanding().data;
  const oldestFirst = [...backing.recent].reverse();

  return (
    <section className={styles.backed} aria-label="Backed">
      <div className={styles.backedHead}>
        <p className={styles.label}>BACKED</p>
        <p className={styles.backedFigure}>{formatInteger(backing.fundedTotal)} MON</p>
      </div>
      <ul className={styles.board} aria-label="Recent deposits">
        {oldestFirst.length === 0 ? (
          <li className={styles.boardEmpty}>NO DEPOSITS YET</li>
        ) : (
          oldestFirst.map((deposit, i) => (
            <li
              key={`${deposit.agent.ticker}-${deposit.depositedAt}`}
              className={styles.boardRow}
              style={{ "--i": i } as React.CSSProperties}
              aria-label={`${deposit.agent.name} · ${formatInteger(deposit.amount)} MON`}
            >
              {Array.from({ length: Math.min(4, Math.max(1, deposit.agent.markSize)) }, (_, b) => (
                <Mark key={b} hue={hueOf(deposit.agent.accent)} className={styles.block} />
              ))}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

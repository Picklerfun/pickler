"use client";

import { useCallback, useState } from "react";
import { Icon } from "@pickler/ui";
import { swatchVars } from "@/lib/accent";
import styles from "../apply.module.css";
import {
  ARENA_STATE_START,
  arenaRows,
  arenaTick,
  clock,
  formatAusd,
  formatDelta,
  poolTotal,
} from "../lib/demo-model";
import { useDemoTick } from "../lib/use-demo-tick";
import { Mark } from "./mark";

const TICK_MS = 2200;

/**
 * AGENTS FIGHT FOR THE LIQUIDITY: five agents whose AUSD moves between them every tick, weighted by
 * hit rate, with the pool's total and the last three flows beside them. A picture of the season, not
 * a reading of one: the board, the pool and the flows are hidden from assistive technology, and the
 * two sentences around them are what is read.
 */
export function Arena() {
  const [state, setState] = useState(ARENA_STATE_START);
  const tick = useCallback(() => setState((current) => arenaTick(current, Math.random)), []);
  useDemoTick(TICK_MS, tick);

  return (
    <section id="arena" className={styles.arena} data-surface="dark" aria-labelledby="arena-title">
      <div className={styles.arenaHead}>
        <div>
          <p className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            THE ARENA · SEASON 1 · <span aria-hidden="true">{clock(state.secs)}</span>
          </p>
          <h2 id="arena-title" className={styles.arenaTitle}>
            AGENTS FIGHT FOR THE LIQUIDITY<span className={styles.limeStop}>.</span>
          </h2>
        </div>
        <p className={styles.arenaLead}>
          Backers move their AUSD to whoever is right. Losers shrink. The season&apos;s winner takes
          the pool.
        </p>
      </div>

      <div className={styles.arenaRow}>
        <div className={styles.board} aria-hidden="true">
          {arenaRows(state.rows).map((row) => (
            <div
              key={row.ticker}
              className={`${styles.agentRow} ${row.leader ? styles.agentRowLead : ""}`}
              style={swatchVars(row.swatch)}
            >
              <span className={styles.rank}>{row.rank}</span>
              <span className={styles.tickerTile} data-swatch={row.swatch}>
                {row.ticker.slice(1)}
              </span>
              <span className={styles.agentBody}>
                <span className={styles.agentLine}>
                  <span className={styles.agentName}>{row.name}</span>
                  <span className={styles.agentHit}>{row.hit}% HIT</span>
                  <span
                    className={`${styles.agentDelta} ${row.delta < 0 ? styles.agentDeltaLoss : ""}`}
                  >
                    {formatDelta(row.delta)}
                  </span>
                </span>
                <span className={styles.bar}>
                  <span className={styles.barFill} style={{ width: `${row.pct}%` }} />
                </span>
              </span>
              <span className={styles.agentLiq}>
                {formatAusd(row.liq)} <span className={styles.unit}>AUSD</span>
              </span>
            </div>
          ))}
        </div>

        <div className={styles.arenaSide}>
          <div className={styles.pool} aria-hidden="true">
            <span className={styles.label}>THE POOL</span>
            <p className={styles.poolFigure}>
              {formatAusd(poolTotal(state.rows))}
              <span className={styles.poolUnit}>AUSD</span>
            </p>
            <div className={styles.flows}>
              {state.flows.map((flow) => (
                <span key={flow.id} className={styles.flow}>
                  <Mark swatch={flow.from} className={styles.flowMark} />
                  <Icon name="arrow" size={11} className={styles.flowArrow} />
                  <Mark swatch={flow.to} className={styles.flowMark} />
                  {formatAusd(flow.amount)} AUSD
                </span>
              ))}
            </div>
          </div>
          {/* Lime ground with near-black ink inside a dark block: the one place in the arena where the
              ink has to invert back, so the card takes the light surface and reads it as any other. */}
          <div className={styles.seat} data-surface="light">
            <span className={styles.seatLabel}>YOUR SEAT</span>
            <p className={styles.seatText}>
              A new agent enters at zero. Its first right call is its first AUSD.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

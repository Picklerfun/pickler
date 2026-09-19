"use client";

import { useState } from "react";
import styles from "../landing.module.css";
import { ACCENT_ORDER, accentVars } from "@/lib/accent";
import { formatAgo, formatInteger } from "../lib/format";
import { useAnimationInterval, useLanding } from "../lib/landing-data";

const GRID_CELLS = 21;
const SPAWN_ROTATE_MS = 3400;

export function AgentsCreated() {
  const { data, nowMs } = useLanding();
  const { spawns, stats } = data;
  const [spawnIndex, setSpawnIndex] = useState(0);
  useAnimationInterval(() => setSpawnIndex((i) => i + 1), SPAWN_ROTATE_MS);

  const lit = Math.max(1, Math.min(GRID_CELLS, stats.agentsCreatedToday));
  const spawn = spawns.length > 0 ? spawns[spawnIndex % spawns.length] : undefined;
  const spawnedRecently = spawn && nowMs - Date.parse(spawn.createdAt) < 10 * 60_000;

  return (
    <div className={styles.created}>
      <span
        className={`${styles.cornerPixel} ${styles.cornerCreated}`}
        style={accentVars("magenta")}
        aria-hidden="true"
      />
      <div className={styles.labelRow}>
        <span className={styles.liveDot} aria-hidden="true" />
        <h2 className={styles.label}>AGENTS CREATED</h2>
      </div>
      <p className={styles.bigCount}>{formatInteger(stats.agentsCreated)}</p>
      <p className={styles.createdNote}>people are building them right now</p>
      <div
        className={styles.awakeGrid}
        aria-label={`${formatInteger(stats.agentsCreatedToday)} created in the last 24 hours`}
        role="img"
      >
        {Array.from({ length: GRID_CELLS }, (_, i) => {
          const on = i < lit;
          const fresh = i === lit - 1;
          return (
            <span
              // Re-keying the fresh cell replays its pop animation on each spawn.
              key={fresh ? `fresh-${spawnIndex}` : i}
              className={`${styles.awakeCell} ${on ? styles.awakeCellOn : ""} ${fresh ? styles.awakeCellFresh : ""}`}
              style={on ? accentVars(ACCENT_ORDER[i % ACCENT_ORDER.length]!) : undefined}
            />
          );
        })}
      </div>
      {spawn && (
        <div key={spawnIndex} className={styles.spawn} style={accentVars(spawn.accent)}>
          <span className={styles.pixel} aria-hidden="true" />
          <span className={styles.spawnName}>{spawn.name}</span>
          <span className={styles.spawnNote}>
            {spawnedRecently ? "just spawned" : `spawned ${formatAgo(spawn.createdAt, nowMs)}`}
          </span>
        </div>
      )}
    </div>
  );
}

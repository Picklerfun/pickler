"use client";

import styles from "../landing.module.css";
import { formatInteger, formatPercent, formatSignedMon } from "../lib/format";
import { useLanding } from "../lib/landing-data";

export function TopAgents() {
  const { leaderboard } = useLanding().data;
  return (
    <div className={styles.board}>
      <div className={styles.boardHead}>
        <h2 id="agents-title" className={styles.boardTitle}>
          TOP AGENTS
        </h2>
        <span className={styles.boardSub}>HOW THEY ARE BETTING · NOT HOW THE TOKEN TRADES</span>
      </div>
      <ol className={styles.boardList}>
        {leaderboard.map((score, i) => (
          <li key={score.agent.ticker} className={styles.boardItem}>
            <span className={styles.rank}>{String(i + 1).padStart(2, "0")}</span>
            <span className={styles.boardAgent}>
              <span className={styles.boardName}>{score.agent.name}</span>
              <span className={styles.boardMeta}>
                {score.agent.beat} · {formatInteger(score.resolved)} resolved
              </span>
            </span>
            <span className={styles.hit}>{formatPercent(score.hitRate)} hit</span>
            <span className={`${styles.net} ${score.net < 0 ? styles.toneLoss : styles.toneWin}`}>
              {formatSignedMon(score.net)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

"use client";
import type { ReactElement } from "react";
import { accentVars } from "@/lib/accent";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { LEADER_ASK, READ_WORDS, SHUT, readState } from "./market-model";
import { ReadNote, Shut } from "./market-parts";
import { leaderRows } from "./model";
import styles from "./market.module.css";

/**
 * Marketplace · Leaderboard (canvas 674–690, spec L19): the real one, read the first time this
 * section opens, in the DTO's order. "Who said the truth" with the calibration line only when the
 * score is calibration alone (the DTO's weights otherwise); rank, initials, name, ticker, beat ·
 * resolved, score, hit ("—": the DTO has none) and net. "Ask" is shut with Soon, and carries no
 * price because the leaderboard's DTO has none. The owner's own agent wears the lime edge.
 */
export const Leaders: (props: LiveSectionProps) => ReactElement = ({ agent, live }) => {
  const board = live.leaderboard;
  const state = readState(board, live.preview, (read) => read.entries.length === 0);
  const view = board !== null && board !== "failed" ? leaderRows(board, agent.handle) : null;

  return (
    <LiveSection section="leaders">
      <div className={styles.board} id="live-leaders" data-state={state}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>Who said the truth</h3>
          {view && <span className={styles.listMeta}>{view.tag}</span>}
        </div>

        {state !== "ready" && (
          <ReadNote state={state} words={READ_WORDS.leaders} onRetry={live.readLeaderboard} />
        )}

        {state === "ready" && view && (
          <ol className={styles.rows}>
            {view.rows.map((row) => (
              <li key={row.key} className={styles.leader} data-own={row.own}>
                <span className={styles.rank}>{row.rank}</span>
                <span
                  className={styles.leaderInitials}
                  style={accentVars(row.accent)}
                  aria-hidden="true"
                >
                  {row.initials}
                </span>
                <span>
                  <span className={styles.leaderName}>
                    {row.name} <span className={styles.ticker}>{row.ticker}</span>
                  </span>
                  <span className={styles.leaderBeat}>{row.beat}</span>
                </span>
                <span className={styles.figures}>
                  <span className={styles.figure}>
                    <span className={styles.figureValue}>{row.score}</span>
                    <span className={styles.figureLabel}>SCORE</span>
                  </span>
                  <span className={styles.figure}>
                    <span className={styles.figureValue}>{row.hit}</span>
                    <span className={styles.figureLabel}>HIT</span>
                  </span>
                  <span className={styles.figure}>
                    <span className={styles.figureValue} data-up={row.netUp}>
                      {row.net}
                    </span>
                    <span className={styles.figureLabel}>NET · AUSD</span>
                  </span>
                </span>
                <Shut tone="ask" size="small" label={LEADER_ASK} reason={SHUT.ask} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </LiveSection>
  );
};

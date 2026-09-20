import styles from "../auth.module.css";
import type { AuthBoardData } from "../lib/board-data";

const tone = { win: styles.good, loss: styles.bad, open: undefined };

export function BoardNow({ board }: { board: AuthBoardData }) {
  return (
    <ul className={styles.boardNow} aria-label="Sample public picks">
      <li className={styles.boardNowHead}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span>SAMPLE PUBLIC PICKS</span>
        <span>{board.picksToday} DEMO PICKS</span>
      </li>
      {board.calls.map((call, i) => (
        <li key={i} className={styles.callRow}>
          <span className={styles.callTicker}>{call.ticker}</span>
          <span className={styles.callText}>{call.call}</span>
          <span
            className={`${styles.callResult} ${tone[call.tone] ?? ""}`}
            style={call.tone === "open" ? { color: "#7FE3FF" } : undefined}
          >
            {call.result}
          </span>
        </li>
      ))}
    </ul>
  );
}

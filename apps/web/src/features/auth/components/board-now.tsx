import styles from "../auth.module.css";
import type { AuthBoardData } from "../lib/board-data";

const tone = { win: styles.good, loss: styles.bad, open: undefined };

export function BoardNow({ board }: { board: AuthBoardData }) {
  return (
    <ul className={styles.boardNow} aria-label="On the board right now">
      <li className={styles.boardNowHead}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span>ON THE BOARD RIGHT NOW</span>
        <span>{board.picksToday} PICKS TODAY</span>
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

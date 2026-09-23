import styles from "../landing.module.css";
import type { Hue } from "../lib/palette";
import { Mark } from "./mark";

const MOVES: { title: string; note: string; cost: string; hue: Hue }[] = [
  {
    title: "Create it",
    note: "Name it, pick its markets, set its voice.",
    cost: "FREE · NO WALLET",
    hue: "lime",
  },
  {
    title: "Set its limits",
    note: "How much per pick. What it must never touch.",
    cost: "YOUR CAPS",
    hue: "violet",
  },
  {
    title: "Let it call",
    note: "Pick first, receipt after. Losses stay up.",
    cost: "PUBLIC FROM PICK ONE",
    hue: "amber",
  },
  {
    title: "Launch its token",
    note: "With a record, people can back it.",
    cost: "OPT IN",
    hue: "magenta",
  },
];

/** The second of the page's dark blocks: the studio's ground and panels, inline in a white page. */
export function FourMoves() {
  return (
    <section
      id="how"
      className={styles.moves}
      data-surface="dark"
      aria-labelledby="four-moves-title"
    >
      <h2 id="four-moves-title" className={styles.movesTitle}>
        FOUR MOVES.
      </h2>
      <ol className={styles.movesGrid}>
        {MOVES.map((move) => (
          <li key={move.title} className={styles.move} data-hue={move.hue}>
            <Mark hue={move.hue} className={styles.moveMark} />
            <h3 className={styles.moveTitle}>{move.title}</h3>
            <p className={styles.moveNote}>{move.note}</p>
            <p className={styles.moveCost}>{move.cost}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

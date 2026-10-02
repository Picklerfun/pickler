"use client";
import styles from "./cards.module.css";

/**
 * Talk to it, drawn shut with a Soon tag until it opens (draft spec D12): the card, what it will
 * do in a line, the canvas's starters and the box, none of which does anything yet. The draft's
 * Console and the live Overview each hand it their own canvas's words.
 */
export function TalkSoon({
  id,
  note,
  starters,
  placeholder,
}: {
  /** The card's id (`draft-console-talk`), which the design harness may prove. */
  id: string;
  /** What talking to it will do. It may not promise what the Perpl runtime will do (D19). */
  note: string;
  /** The canvas's starters for this screen, drawn as shut chips. */
  starters: readonly string[];
  /** The shut box's placeholder. */
  placeholder: string;
}) {
  return (
    <div className={styles.talk} id={id}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>TALK TO IT</h3>
        <span className={styles.meta}>ASK WHY · OR TELL IT WHAT TO CHANGE</span>
        <span className={styles.soon}>SOON</span>
      </div>
      <p className={styles.cardNote}>{note}</p>
      <div className={styles.thread}>
        <div className={styles.chips}>
          {starters.map((starter) => (
            <button key={starter} type="button" className={styles.starter} disabled>
              {starter}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.ask}>
        <input
          type="text"
          className={styles.askInput}
          placeholder={placeholder}
          aria-label="Talk to it, soon"
          disabled
        />
        <button type="button" className={styles.send} disabled>
          Send
        </button>
      </div>
    </div>
  );
}

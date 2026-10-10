import styles from "../landing.module.css";
import { LOCK_GRID } from "../lib/demo";

/** Self-custody, as a padlock drawn in cells. */
export function Keys() {
  return (
    <article id="bento-keys" className={`${styles.bentoCard} ${styles.bentoKeys}`}>
      <p className={styles.cardTitle}>Your face is the key.</p>
      <p className={styles.cardNote}>
        A passkey makes the wallet and signs every trade. No seed phrase, no extension, nobody can
        freeze it.
      </p>
      <div className={styles.lockWell}>
        <div className={styles.lockGrid} aria-hidden="true">
          {LOCK_GRID.map((cell, i) => (
            <span key={i} className={styles.lockCell} data-cell={cell ?? undefined} />
          ))}
        </div>
        <span className={styles.lockTag} data-surface="dark">
          <span className={styles.liveDot} aria-hidden="true" />
          FACE ID · PASSKEY · NO SEED PHRASE
        </span>
      </div>
    </article>
  );
}

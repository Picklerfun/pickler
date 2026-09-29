"use client";
import { Button, Tag } from "@pickler/ui";
import styles from "./home.module.css";

/* The canvas's four steps, in its order, with its notes. */
const STEPS = [
  { title: "Voice", note: "HOW EVERY TRADE READS" },
  { title: "Connect X", note: "WHERE IT POSTS" },
  { title: "Its wallet", note: "CAPS FROM THE BRIEF · PASSKEY" },
  { title: "Fund it", note: "AFTER ITS WALLET" },
] as const;

/**
 * GO PUBLIC on a draft's home (studio-brief-v1 §6). The four steps are the next sub-project, so each
 * is marked Soon and none can be started; nothing here is drawn as done.
 */
export function GoPublic() {
  return (
    <section className={styles.column} id="home-go-public" aria-labelledby="home-go-public-title">
      <div className={styles.colBar}>
        <h2 className={styles.colHead} id="home-go-public-title">
          Go public
        </h2>
        <span className={styles.colCount}>0 / 4</span>
      </div>
      <p className={styles.empty}>It stays private and runs on paper until it goes public.</p>
      <ol className={styles.goSteps}>
        {STEPS.map((item, index) => (
          <li key={item.title} className={styles.nextItem}>
            <span className={styles.check} aria-hidden="true">
              {index + 1}
            </span>
            <span className={styles.grow}>
              <span className={styles.nextTitle}>{item.title}</span>
              <span className={styles.nextNote}>{item.note}</span>
            </span>
            <Tag className={styles.soon}>SOON</Tag>
          </li>
        ))}
      </ol>
      <Button variant="secondary" size="sm" disabled>
        4 to go
      </Button>
    </section>
  );
}

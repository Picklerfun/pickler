"use client";
import { Button, Icon } from "@pickler/ui";
import type { NextItem } from "./status";
import styles from "./home.module.css";

/** Next up: one item today, "Fund its wallet", ticked once it holds 10 AUSD. */
export function NextUp({
  items,
  count,
  onDeposit,
}: {
  items: NextItem[];
  count: string;
  onDeposit(): void;
}) {
  return (
    <section className={styles.column} id="home-next" aria-label="Next up">
      <div className={styles.colBar}>
        <h2 className={styles.colHead}>Next up</h2>
        {count && <span className={styles.colCount}>{count}</span>}
      </div>
      {items.length === 0 && (
        <p className={styles.empty}>
          Once its first call is in, the few things worth doing next show up here.
        </p>
      )}
      {items.map((item) => (
        <div key={item.key} className={styles.nextItem} data-done={item.done}>
          <span className={styles.check} data-done={item.done} aria-hidden="true">
            {item.done && <Icon name="check" size={13} />}
          </span>
          <span className={styles.grow}>
            <span className={styles.nextTitle}>{item.title}</span>
            <span className={styles.nextNote}>{item.note}</span>
          </span>
          {!item.done && (
            <Button variant="secondary" size="sm" onClick={onDeposit}>
              {item.cta}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

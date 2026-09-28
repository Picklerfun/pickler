"use client";
import { Icon, Tag } from "@pickler/ui";
import { toggleIn } from "./draft";
import type { StepProps } from "./flow";
import { VENUES } from "./map";
import styles from "./create.module.css";

/** Where it trades. Perpl is drawn, as the canvas draws it, and cannot be chosen yet. */
export function TradesStep({ draft, patch }: StepProps) {
  return (
    <section className={styles.step} id="create-trades">
      <h1 className={styles.headline} tabIndex={-1}>
        WHERE IT TRADES<span>.</span>
      </h1>
      <p className={styles.lead}>Pick one or both. It depends on how you like to play.</p>
      {VENUES.map((venue) => {
        const on = draft.venues.includes(venue.key);
        return (
          <button
            key={venue.key}
            type="button"
            className={styles.card}
            data-on={on}
            aria-pressed={on}
            // A Soon venue a model draft chose stays removable, so the review can be cleared.
            disabled={venue.soon && !on}
            onClick={() => patch({ venues: toggleIn(draft.venues, venue.key) })}
          >
            <span className={styles.check} aria-hidden="true">
              {on && <Icon name="check" size={14} />}
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardHead}>
                <span className={styles.cardTitle}>{venue.name}</span>
                <span className={styles.cardKind}>{venue.kind}</span>
                {venue.soon && <Tag className={styles.soon}>SOON</Tag>}
              </span>
              <span className={styles.cardNote}>{venue.note}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

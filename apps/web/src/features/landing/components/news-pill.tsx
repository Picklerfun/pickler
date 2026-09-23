"use client";

import { Icon } from "@pickler/ui";
import { useState } from "react";
import styles from "../landing.module.css";
import { useLanding } from "../lib/landing-data";

/**
 * The newest announcement, and only that one. The snapshot carries several and the canvas has room
 * for one, so this shows the first rather than rotating through them: a headline that changes under
 * you on a timer is a thing to chase, not to read.
 */
export function NewsPill() {
  const { announcements } = useLanding().data;
  const [open, setOpen] = useState(true);
  const item = announcements[0];

  if (!open || !item) {
    return null;
  }

  return (
    <aside className={styles.news} aria-label="Announcement">
      <span className={styles.newsTag}>{item.tag}</span>
      <span className={styles.newsTitle}>{item.title}</span>
      <a href={item.href} className={styles.newsCta}>
        {item.cta}
        <span className={styles.arrowBadge} aria-hidden="true">
          <Icon name="arrow" size={12} />
        </span>
      </a>
      <button
        type="button"
        className={styles.newsClose}
        onClick={() => setOpen(false)}
        aria-label="Dismiss announcement"
      >
        <Icon name="x" size={13} />
      </button>
    </aside>
  );
}

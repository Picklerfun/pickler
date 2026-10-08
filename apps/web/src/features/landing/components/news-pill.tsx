"use client";

import { Icon } from "@pickler/ui";
import { useState } from "react";
import styles from "../landing.module.css";
import { useLanding } from "../lib/landing-data";

/**
 * The newest announcement, and only that one. The snapshot carries several and the canvas has room
 * for one, so this shows the first rather than rotating through them: a headline that changes under
 * you on a timer is a thing to chase, not to read. The canvas draws the tag, the title and a way to
 * dismiss it; the announcement's own link is on the title.
 */
export function NewsPill() {
  const { announcements } = useLanding().data;
  const [open, setOpen] = useState(true);
  const item = announcements[0];

  if (!open || !item) {
    return null;
  }

  return (
    <div className={styles.newsRow}>
      <aside className={styles.news} aria-label="Announcement">
        <span className={styles.newsTag}>{item.tag}</span>
        <a href={item.href} className={styles.newsTitle}>
          {item.title}
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
    </div>
  );
}

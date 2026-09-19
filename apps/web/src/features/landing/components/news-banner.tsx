"use client";

import { Icon, Button } from "@pickler/ui";
import { useState } from "react";
import styles from "../landing.module.css";
import { useLanding } from "../lib/landing-data";

export function NewsBanner() {
  const { announcements } = useLanding().data;
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);

  const item = announcements[index] ?? announcements[0];
  if (!open || !item) {
    return null;
  }

  return (
    <aside className={styles.news} aria-label="Announcements">
      <div className={styles.newsCard} aria-live="polite">
        <span className={styles.newsPixels} aria-hidden="true">
          <span />
          <span />
        </span>
        <span className={styles.newsTag}>{item.tag}</span>
        <span className={styles.newsTitle}>{item.title}</span>
        <span className={styles.newsBody}>{item.body}</span>
        <a href={item.href} className={styles.newsCta}>
          {item.cta}
          <span className={styles.arrowChip} aria-hidden="true">
            <Icon name="arrow" size={13} />
          </span>
        </a>
        <Button
          variant="secondary"
          className={styles.newsClose}
          onClick={() => setOpen(false)}
          aria-label="Dismiss announcements"
        >
          <Icon name="x" size={13} />
        </Button>
      </div>
      {announcements.length > 1 && (
        <div className={`${styles.dots} ${styles.newsDots}`}>
          {announcements.map((announcement, i) => (
            <button
              key={announcement.title}
              type="button"
              className={`${styles.dot} ${i === index ? styles.dotActive : ""}`}
              onClick={() => setIndex(i)}
              aria-label={`Show announcement ${i + 1}: ${announcement.title}`}
              aria-pressed={i === index}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

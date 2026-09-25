"use client";
import { accentVars } from "@/lib/accent";
import type { HomeStatus } from "./status";
import styles from "./home.module.css";

/** The mark's two letters: a word's first letter each, or a single word's first two ("HA"). */
export const initials = (value: string): string => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0] ?? "").join("") : (words[0] ?? "");
  return letters.slice(0, 2).toUpperCase() || "AG";
};

/**
 * The agent itself: its mark (ringed while it works), the mood bubble and the line it says. The
 * DTO carries no accent yet, so the mark takes the studio's lime, as the canvas draws it.
 */
export function AgentCard({ name, status }: { name: string; status: HomeStatus }) {
  return (
    <section className={styles.agent} id="home-agent" aria-label={name}>
      <h2 className={styles.colHead}>{name}</h2>
      <div className={styles.moodRow}>
        <div className={styles.mark} style={accentVars("lime")} aria-hidden="true">
          {status.working && <span className={styles.ring} />}
          <span className={styles.markFace}>{initials(name)}</span>
        </div>
        <div className={styles.bubble} data-tint={status.moodTint} role="status">
          <p className={styles.moodLabel}>
            <span className={styles.moodDot} />
            {status.mood}
          </p>
          <p className={styles.moodSub}>{status.moodSub}</p>
        </div>
      </div>
      <div className={styles.say}>
        <p>
          {status.say}
          <span className={styles.caret} data-on={status.working} aria-hidden="true" />
        </p>
      </div>
    </section>
  );
}

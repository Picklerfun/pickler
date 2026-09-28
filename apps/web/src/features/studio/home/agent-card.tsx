"use client";
import type { AccentDto } from "@pickler/api-schema";
import { accentVars } from "@/lib/accent";
import { agentInitials } from "../lib/initials";
import type { HomeStatus } from "./status";
import styles from "./home.module.css";

/**
 * The agent itself: its mark (ringed while it works) in its own accent, painted from the agent
 * palette through `accentVars` as everywhere else on the site, the mood bubble and the line it says.
 */
export function AgentCard({
  name,
  accent,
  status,
}: {
  name: string;
  accent: AccentDto;
  status: HomeStatus;
}) {
  return (
    <section className={styles.agent} id="home-agent" aria-label={name}>
      <h2 className={styles.colHead}>{name}</h2>
      <div className={styles.moodRow}>
        <div className={styles.mark} style={accentVars(accent)} aria-hidden="true">
          {status.working && <span className={styles.ring} />}
          <span className={styles.markFace}>{agentInitials(name)}</span>
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

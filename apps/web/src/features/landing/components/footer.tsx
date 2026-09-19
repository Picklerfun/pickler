"use client";

import styles from "../landing.module.css";
import { ACCENT_ORDER, accentVars } from "@/lib/accent";
import { useLanding } from "../lib/landing-data";

export function Footer() {
  const { source } = useLanding().data;
  return (
    <footer className={styles.footer}>
      <div className={`${styles.container} ${styles.footerRow}`}>
        <span className={styles.footerPixels} aria-hidden="true">
          {ACCENT_ORDER.map((accent) => (
            <span key={accent} style={accentVars(accent)} />
          ))}
        </span>
        {source === "sample" && <span className={styles.sampleTag}>SAMPLE DATA</span>}
        <span className={styles.spacer} />
        <a href="#agents" className={styles.footerLink}>
          AGENTS
        </a>
        <a href="#launching" className={styles.footerLink}>
          TOKENS
        </a>
        <a href="#how" className={styles.footerLink}>
          HOW IT WORKS
        </a>
        <span className={styles.footerNote}>PICKLER · 2026</span>
      </div>
    </footer>
  );
}

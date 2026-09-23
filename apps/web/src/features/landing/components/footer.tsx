"use client";

import styles from "../landing.module.css";
import { useLanding } from "../lib/landing-data";
import { PALETTE } from "../lib/palette";
import { Mark } from "./mark";

export function Footer() {
  const { source } = useLanding().data;
  return (
    <footer className={styles.footer}>
      <div className={styles.footerRow}>
        <span className={styles.swatches}>
          {PALETTE.map((hue) => (
            <Mark key={hue} hue={hue} className={styles.swatch} />
          ))}
        </span>
        {/* Every number on this page is a snapshot of something real, and this says when the
            something real is the sample read model rather than a live one. */}
        {source === "sample" && <span className={styles.sampleTag}>SAMPLE DATA</span>}
        <span className={styles.footerSpacer} />
        <a href="#how" className={styles.footerLink}>
          HOW IT WORKS
        </a>
        <span className={styles.footerNote}>PICKLER · 2026</span>
      </div>
    </footer>
  );
}

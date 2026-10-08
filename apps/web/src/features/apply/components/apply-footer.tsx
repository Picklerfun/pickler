import Link from "next/link";
import type { Swatch } from "@/lib/accent";
import styles from "../apply.module.css";
import { Mark } from "./mark";

/** The seven palette hues, in the order the canvas lays them out. */
const SWATCH_ROW: Swatch[] = ["lime", "indigo", "amber", "orange", "magenta", "blue", "violet"];

export function ApplyFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerRow}>
        <span className={styles.swatches}>
          {SWATCH_ROW.map((swatch) => (
            <Mark key={swatch} swatch={swatch} className={styles.swatch} />
          ))}
        </span>
        <span className={styles.footerSpacer} />
        <Link href="/" className={styles.footerLink}>
          TRADE WITH AI
        </Link>
        <Link href="/agents" className={styles.footerLink}>
          AGENTS
        </Link>
        <Link href="/markets" className={styles.footerLink}>
          MARKETS
        </Link>
        <span className={styles.footerNote}>PICKLER · 2026</span>
      </div>
    </footer>
  );
}

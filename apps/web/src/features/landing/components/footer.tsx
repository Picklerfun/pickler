import Link from "next/link";
import styles from "../landing.module.css";
import { PALETTE } from "../lib/palette";
import { Mark } from "./mark";

export function Footer({ charts = false }: { charts?: boolean }) {
  return (
    <footer className={`${styles.shell} ${styles.footer}`}>
      <div className={styles.footerRow}>
        <span className={styles.swatches} aria-hidden="true">
          {PALETTE.map((hue) => (
            <Mark key={hue} hue={hue} className={styles.swatch} />
          ))}
        </span>
        <span className={styles.footerSpacer} />
        <Link href="/agents" className={styles.footerLink}>
          AGENTS
        </Link>
        <Link href="/perpl" className={styles.footerLink}>
          PERPL DASHBOARD
        </Link>
        <a href="#app" className={styles.footerLink}>
          THE APP
        </a>
        <Link href="/create" className={styles.footerLink}>
          CREATE AN AGENT
        </Link>
        {charts && (
          <a
            href="https://www.tradingview.com/"
            className={styles.footerLink}
            target="_blank"
            rel="noreferrer"
          >
            Charts by TradingView
          </a>
        )}
        <span className={styles.footerNote}>PICKLER · 2026</span>
      </div>
    </footer>
  );
}

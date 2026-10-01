"use client";

import { SiteNav } from "@/features/site/site-nav";
import type { ReactNode } from "react";
import styles from "../agents.module.css";

/**
 * The shell every marketplace route shares: the bar, the page ground and the footer.
 *
 * It is light, which is what the marketplace is: every route inside it is on the light surface.
 */
export function PublicShell({
  children,
  charts = false,
}: {
  children: ReactNode;
  /**
   * Whether anything on this page draws with Lightweight Charts. Two routes do — `/tokens/[ticker]`
   * through `CandleChart` and `/leaderboard` through `BarChart` — and they are the two that owe the
   * credit below. A page that adds a chart has to set this; nothing enforces it, which is the cost
   * of the footer being the shell's to lay out rather than the chart's.
   */
  charts?: boolean;
}) {
  return (
    <div className={styles.page} data-surface="light">
      <SiteNav connect />
      {children}
      <footer className={styles.credit}>
        {/* Our charts are drawn with TradingView's Lightweight Charts™. We hide the logo the library
            paints inside the panel, so its licence asks for the credit and the link to live on the
            page instead — on the pages where a logo was hidden, which is what makes it a credit
            rather than a decoration. Eleven of these thirteen routes draw nothing. */}
        {charts && (
          <span>
            Charts by{" "}
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">
              TradingView
            </a>
          </span>
        )}
        <span className={styles.creditNote}>PICKLER · 2026</span>
      </footer>
    </div>
  );
}

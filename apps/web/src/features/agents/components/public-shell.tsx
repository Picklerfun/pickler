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
   * Pages mounting Lightweight Charts opt in to the required attribution. The local public
   * token-market preview uses AreaChart; routes without a chart keep the plain product footer.
   */
  charts?: boolean;
}) {
  return (
    <div className={styles.page} data-surface="light">
      <SiteNav connect />
      {children}
      <footer className={styles.credit}>
        {/* Keep library attribution on pages that actually mount a chart. */}
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

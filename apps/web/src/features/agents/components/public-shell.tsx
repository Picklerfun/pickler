"use client";

import { SiteNav } from "@/features/site/site-nav";
import type { ReactNode } from "react";
import styles from "../agents.module.css";

/**
 * The shell every marketplace route shares: the bar, the page ground and the chart credit.
 *
 * It is light, which is what the marketplace is. `surface` exists for the routes whose *bodies*
 * still compose against a dark ground — the agent pages — because one wrapper cannot hold two
 * surfaces and those bodies are not this task's to redraw. A dark shell brings back the ground
 * they compose against; a light one has none to bring. The prop goes when the last body is redrawn.
 */
export function PublicShell({
  children,
  surface = "light",
}: {
  children: ReactNode;
  surface?: "light" | "dark";
}) {
  return (
    <div className={styles.page} data-surface={surface}>
      {surface === "dark" && (
        <div aria-hidden="true">
          <div className={styles.space} />
          <div className={styles.stars} />
        </div>
      )}
      <SiteNav connect surface={surface} />
      {children}
      {/* Our charts are drawn with TradingView's Lightweight Charts™. We hide the logo the library
          paints inside the panel, so its licence asks for the credit and the link to live on the
          page instead — here, once, for every public view. */}
      <footer className={styles.credit}>
        <span>
          Charts by{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">
            TradingView
          </a>
        </span>
        <span className={styles.creditNote}>PICKLER · 2026</span>
      </footer>
    </div>
  );
}

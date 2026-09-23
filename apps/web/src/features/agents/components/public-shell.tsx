"use client";

import { SiteNav } from "@/features/site/site-nav";
import type { ReactNode } from "react";
import styles from "../agents.module.css";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    // Pinned dark: .space paints a full-bleed opaque gradient with a starfield over it, so the
    // ground this page actually has is not the white one the token names. This shell carries every
    // marketplace route — agents, markets, tokens, reads, leaderboard, portfolio, activity — so the
    // pin covers all seven. It comes off route by route as their canvases land.
    <div className={styles.page} data-surface="dark">
      <div aria-hidden="true">
        <div className={styles.space} />
        <div className={styles.stars} />
      </div>
      <SiteNav connect />
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

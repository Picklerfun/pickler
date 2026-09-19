"use client";

import styles from "../landing.module.css";
import { formatInteger } from "../lib/format";
import { useLanding } from "../lib/landing-data";

export function HeroStats() {
  const { stats } = useLanding().data;
  const items = [
    { label: "TOTAL VOLUME", value: stats.totalVolume },
    { label: "TOTAL MCAP", value: stats.totalMarketCap },
    { label: "AGENTS FUNDED", value: stats.agentsFunded },
    { label: "HUMANS IN LINE", value: stats.waitlistCount },
  ];
  return (
    <dl className={styles.heroStats}>
      {items.map((item) => (
        // dd before dt matches the design's value-over-label layout.
        <div key={item.label} className={styles.stat}>
          <dt>{item.label}</dt>
          <dd>{formatInteger(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

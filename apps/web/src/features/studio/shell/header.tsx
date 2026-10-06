"use client";
import type { ReactNode } from "react";
import type { Agent } from "../api";
import { AgentAvatar } from "./agent-avatar";
import type { HeaderTile } from "./model";
import styles from "./shell.module.css";

/**
 * The header over every section: the avatar, the agent's name, the line under it (`sub`, its parts
 * as spans with `HeaderDot` between them), and on the right whatever the studio puts there: the
 * workspace status and the live studio's controls. The sidebar switcher carries agent balances.
 */
export function StudioHeader({
  accent,
  pattern,
  name,
  sub,
  side,
}: {
  accent: Agent["accent"];
  pattern: number;
  name: string;
  sub: ReactNode;
  side?: ReactNode;
}) {
  return (
    <div className={styles.header}>
      <AgentAvatar accent={accent} pattern={pattern} size="head" />
      <div className={styles.headText}>
        <h1 className={styles.name}>{name}</h1>
        <p className={styles.sub}>{sub}</p>
      </div>
      {side}
    </div>
  );
}

/** The dot between two parts of the header's line. */
export function HeaderDot() {
  return (
    <span className={styles.subDot} aria-hidden="true">
      ·
    </span>
  );
}

/** The row of tiles under the header; a tile not built yet reads "Soon", quieter than a number. */
export function StudioTiles({ tiles, label }: { tiles: HeaderTile[]; label: string }) {
  return (
    <ul className={styles.tiles} aria-label={label}>
      {tiles.map((tile) => (
        <li key={tile.label} className={styles.tile} data-soon={tile.soon}>
          <span className={styles.tileValue}>{tile.value}</span>
          <span className={styles.tileLabel}>{tile.label}</span>
        </li>
      ))}
    </ul>
  );
}

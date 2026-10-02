"use client";
import { accentVars } from "@/lib/accent";
import type { Agent } from "../api";
import { patternCells } from "../new-agent/model";
import styles from "./shell.module.css";

/** The agent's avatar: its accent and one of the six patterns, as its profile holds them. */
export function AgentAvatar({
  accent,
  pattern,
  size,
}: {
  accent: Agent["accent"];
  pattern: number;
  /** The top bar's chip, the header, or Identity & voice's card. */
  size: "chip" | "head" | "large";
}) {
  return (
    <span className={styles.avatar} data-size={size} style={accentVars(accent)} aria-hidden="true">
      <span className={styles.avatarCells}>
        {patternCells(pattern).map((on, index) => (
          <span key={index} className={styles.avatarCell} data-on={on} />
        ))}
      </span>
    </span>
  );
}

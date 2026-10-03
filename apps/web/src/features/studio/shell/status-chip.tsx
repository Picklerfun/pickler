"use client";
import type { ReactNode } from "react";
import styles from "./shell.module.css";

/**
 * The agent's status, as the top bar and the header both say it: a dot and a few capitals. Without
 * a tone it is the draft's amber on the panel (DRAFT · PRIVATE); `good` and `caution` sit on their
 * washes, for the live studio's states.
 */
export function StatusChip({
  id,
  tone,
  children,
}: {
  id?: string | undefined;
  tone?: "good" | "caution" | undefined;
  children: ReactNode;
}) {
  return (
    <span className={styles.status} id={id} data-tone={tone}>
      <span className={styles.statusDot} />
      {children}
    </span>
  );
}

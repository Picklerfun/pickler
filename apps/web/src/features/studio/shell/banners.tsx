"use client";
import type { ReactNode } from "react";
import { Icon } from "@pickler/ui";
import { PREVIEW_NOTE } from "./use-agent-studio";
import styles from "./shell.module.css";

/** Over the header of a staged or preview studio: nothing on it is saved. */
export function PreviewBanner() {
  return (
    <p className={styles.note} role="status">
      <Icon name="alert" size={13} />
      {PREVIEW_NOTE}
    </p>
  );
}

/** Under the tiles: the last read that failed, in words. */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <p className={styles.alert} role="alert">
      <Icon name="alert" size={13} />
      {children}
    </p>
  );
}

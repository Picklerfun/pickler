"use client";
import { useState } from "react";
import { PREVIEW_NOTE } from "../shell/use-agent-studio";
import type { ReadState } from "./market-model";
import styles from "./market.module.css";

/**
 * A shut button (draft spec D19): drawn as the canvas draws it with its SOON, `aria-disabled` so a
 * keyboard still reaches it, named "{label}, soon" with the reason in its title (its accessible
 * description, so it is read once). A click does nothing.
 */
export function Shut({
  label,
  reason,
  tone,
  size,
}: {
  label: string;
  /** Why it is shut (`SHUT` in `market-model.ts`). */
  reason: string;
  /** `ask` is the violet of a paid read. */
  tone?: "ask";
  size?: "small";
}) {
  return (
    <button
      type="button"
      className={styles.shut}
      data-tone={tone}
      data-size={size}
      aria-disabled="true"
      aria-label={`${label}, soon`}
      title={reason}
    >
      {label}
      <span className={styles.soon} aria-hidden="true">
        SOON
      </span>
    </button>
  );
}

/**
 * A marketplace read that is not ready: "Reading…" while it reads, the failure with Retry, the
 * empty line, or, in a preview studio that read nothing, `PREVIEW_NOTE`. Retry says "Retrying…"
 * until the read answers.
 */
export function ReadNote({
  state,
  words,
  onRetry,
}: {
  state: Exclude<ReadState, "ready">;
  words: { loading: string; failed: string; empty: string };
  onRetry(): Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (retrying) {
      return;
    }
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  if (state === "loading") {
    return (
      <p className={styles.note} role="status">
        {words.loading}
      </p>
    );
  }
  if (state === "failed") {
    return (
      <div className={styles.note} role="alert">
        <span>{words.failed}</span>
        <button
          type="button"
          className={styles.retry}
          aria-disabled={retrying || undefined}
          onClick={() => void retry()}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }
  if (state === "preview") {
    return <p className={styles.note}>{PREVIEW_NOTE}</p>;
  }
  return <p className={styles.note}>{words.empty}</p>;
}

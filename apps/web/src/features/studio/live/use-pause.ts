"use client";
import { useCallback, useRef, useState } from "react";
import { errorCode } from "../api";
import { PREVIEW_NOTE } from "../shell/use-agent-studio";

/** Where "Pause entries" / "Resume" was pressed: the header, or Controls' STOPS. */
export type PauseOrigin = "header" | "stops";

/**
 * "Pause entries" / "Resume" (spec L4, L13), one state for both of its buttons: pressing either
 * marks both pending, and a failure is said under the one that was pressed. `pendingLabel` is
 * "Pausing…" / "Resuming…" while the write runs, null otherwise.
 */
export interface PauseToggle {
  pending: boolean;
  pendingLabel: string | null;
  /** The failure's words and where it was pressed, or null. */
  error: { text: string; from: PauseOrigin } | null;
  toggle(from: PauseOrigin): Promise<void>;
}

/**
 * The live studio's one pause control, called once by `LiveStudio` and handed to the header and to
 * Controls. A second press while the first is pending does nothing; a failure changes nothing and
 * says why (a preview studio says it saves nothing).
 */
export function usePauseToggle(
  pause: (paused: boolean) => Promise<void>,
  paused: boolean,
): PauseToggle {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PauseToggle["error"]>(null);
  const busy = useRef(false);

  const toggle = useCallback(
    async (from: PauseOrigin) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        await pause(!paused);
      } catch (caught) {
        let text = caught instanceof Error ? caught.message : "It didn't change. Try again.";
        if (errorCode(caught) === "PREVIEW") {
          text = PREVIEW_NOTE;
        }
        setError({ text, from });
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [pause, paused],
  );

  let pendingLabel: string | null = null;
  if (pending) {
    pendingLabel = paused ? "Resuming…" : "Pausing…";
  }

  return { pending, pendingLabel, error, toggle };
}

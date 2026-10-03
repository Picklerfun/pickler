"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long a Copy chip says COPIED. */
const COPIED_MS = 1400;

/**
 * A Copy chip's state: `copy(text)` writes it to the clipboard and `copied` stays true for a
 * moment after; a refused write says nothing. The timer is cleared on unmount, and an answer that
 * lands after it is dropped.
 */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        if (!mounted.current) {
          return;
        }
        setCopied(true);
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => undefined,
    );
  }, []);

  return [copied, copy];
}

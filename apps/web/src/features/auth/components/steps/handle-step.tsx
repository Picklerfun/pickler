"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input } from "@pickler/ui";
import styles from "../../auth.module.css";
import { isAuthConfigured } from "../../lib/config";
import { HANDLE_MAX, handleNote, normalizeHandle } from "../../lib/handle";
import { checkHandle, type HandleAvailability } from "../../lib/pickler-api";

// Moved from sign-up-flow.tsx unchanged. It is the reason a handle is checked once you stop
// typing rather than once per keystroke, and the reason an answer that arrives after the name
// has moved on is thrown away instead of shown against the wrong name.
function useHandleCheck(handle: string) {
  const [result, setResult] = useState<{
    handle: string;
    state: HandleAvailability | "error";
  } | null>(null);
  useEffect(() => {
    if (handle.length < 3 || !isAuthConfigured()) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setResult({ handle, state: await checkHandle(handle, controller.signal) });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ handle, state: "error" });
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle]);
  return result?.handle === handle ? result.state : null;
}

/**
 * Claim a name before there is a wallet to attach it to. The handle is the account's, and the
 * agents made later share the same namespace, which is why the note says so.
 */
export function HandleStep({
  handle: initial,
  error,
  busy = false,
  onClaimed,
}: {
  handle: string;
  /** A name the server refused when it was actually claimed — the race the check cannot close. */
  error?: string | null | undefined;
  busy?: boolean | undefined;
  onClaimed: (handle: string) => void;
}) {
  const [handle, setHandle] = useState(initial);
  const configured = isAuthConfigured();
  const note = handleNote(handle, useHandleCheck(handle), configured);

  function claim(event: FormEvent) {
    event.preventDefault();
    if (note.ready && !busy) {
      onClaimed(handle);
    }
  }

  return (
    <form className={styles.flowStep} onSubmit={claim}>
      <h1 className={styles.flowTitle}>PICK A HANDLE</h1>

      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      <Field className={styles.handleField} note={note.text} tone={note.tone}>
        <span className={styles.srOnly}>Handle</span>
        <Input
          prefix="@"
          mono
          size="lg"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="nightowl"
          maxLength={HANDLE_MAX}
          value={handle}
          onChange={(event) => setHandle(normalizeHandle(event.target.value))}
          invalid={note.tone === "bad"}
          required
        />
      </Field>

      <Button type="submit" className={styles.primary} disabled={!note.ready || busy} arrow>
        {busy ? "Claiming…" : "Continue"}
      </Button>
    </form>
  );
}

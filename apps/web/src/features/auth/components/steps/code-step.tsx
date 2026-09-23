"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@pickler/ui";
import styles from "../../auth.module.css";
import { sendEmailCode, verifyEmailCode } from "../../lib/account";
import { isAuthConfigured } from "../../lib/config";
import {
  CODE_LENGTH,
  RESEND_SECONDS,
  codeCells,
  isComplete,
  normalizeCode,
  resendLabel,
  triesLeft,
} from "../../lib/otp";
import { getSupabase } from "../../lib/supabase-browser";

/**
 * Six boxes with one real input laid over them at `opacity: 0`.
 *
 * The caret, the keyboard and the autofill of a code out of an email stay the operating system's;
 * only the boxes are ours. The usual failures of this pattern are handled rather than inherited:
 * the input is the single focusable thing and carries the label, the boxes are `aria-hidden` so a
 * screen reader hears one field instead of six empty ones, and the focus ring an invisible input
 * cannot show is drawn on the boxes by `.codeInput:focus-visible ~` in auth.module.css.
 */
export function CodeStep({
  email,
  code,
  onCode,
  onVerified,
  onChangeEmail,
}: {
  email: string;
  code: string;
  onCode: (code: string) => void;
  onVerified: () => void;
  onChangeEmail: () => void;
}) {
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitFor, setWaitFor] = useState(RESEND_SECONDS);
  // Guards against verifying the same six digits twice: React may run an effect again, and a
  // second verify of a code the first one already spent would look like a wrong code.
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (waitFor <= 0) {
      return;
    }
    const timer = setTimeout(() => setWaitFor((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitFor]);

  const left = triesLeft(attempts);
  const cells = codeCells(code, rejected);

  async function verify(candidate: string) {
    const supabase = getSupabase();
    if (!supabase || tried.current === candidate) {
      return;
    }
    tried.current = candidate;
    setBusy(true);
    setError(null);
    try {
      if (await verifyEmailCode(supabase, email, candidate)) {
        onVerified();
      } else {
        setRejected(true);
        setAttempts((used) => used + 1);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check that code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function type(raw: string) {
    const next = normalizeCode(raw);
    if (next === code) {
      return;
    }
    setRejected(false);
    setError(null);
    onCode(next);
    if (isComplete(next) && isAuthConfigured()) {
      void verify(next);
    }
  }

  function resend() {
    const supabase = getSupabase();
    if (!supabase || waitFor > 0) {
      return;
    }
    setWaitFor(RESEND_SECONDS);
    setRejected(false);
    setAttempts(0);
    setError(null);
    tried.current = null;
    onCode("");
    void sendEmailCode(supabase, email).catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : "Could not send another code."),
    );
  }

  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>CHECK YOUR EMAIL</h1>
      <p className={styles.flowLead}>
        {CODE_LENGTH} DIGITS · {email.toUpperCase()}
      </p>

      <label className={styles.codeBoxes}>
        <span className={styles.srOnly}>{CODE_LENGTH}-digit code from your email</span>
        {/* Before the boxes in the DOM so the ring can reach them with a sibling selector. */}
        <input
          className={styles.codeInput}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          autoFocus
          value={code}
          onChange={(event) => type(event.target.value)}
          aria-invalid={rejected || undefined}
          aria-describedby={rejected ? "code-alert" : undefined}
        />
        {cells.map((cell, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={[
              styles.codeCell,
              cell.wrong ? styles.codeWrong : "",
              cell.caret ? styles.codeCaret : "",
              cell.filled && !cell.wrong ? styles.codeFilled : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {cell.char}
          </span>
        ))}
      </label>

      {rejected && (
        <p className={styles.codeAlert} id="code-alert" role="alert">
          {/* Supabase answers a wrong code and an expired one with the same error, so this does
              not claim to know which it was. */}
          <span className={styles.codeAlertText}>
            That code did not work. It may be wrong, or it may have run out.
          </span>
          <span className={styles.codeAlertTag}>
            {left > 0 ? `${left} ${left === 1 ? "TRY" : "TRIES"} LEFT` : "ASK FOR A NEW ONE"}
          </span>
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      <div className={styles.codeFoot}>
        <Button variant="ghost" size="sm" mono onClick={onChangeEmail}>
          ← CHANGE
        </Button>
        {busy && (
          <span className={styles.busyNote}>
            <span className={styles.busyDot} aria-hidden="true" />
            VERIFYING
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          mono
          className={styles.resend}
          disabled={waitFor > 0}
          onClick={resend}
        >
          {resendLabel(waitFor)}
        </Button>
      </div>
    </div>
  );
}

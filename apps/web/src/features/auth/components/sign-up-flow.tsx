"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../auth.module.css";
import {
  ensureProfile,
  signInWithWallet,
  signUpWithEmail,
  type AccountResult,
} from "../lib/account";
import type { AuthBoardData } from "../lib/board-data";
import { isAuthConfigured } from "../lib/config";
import { Button, Field, Icon, Input, type FieldTone } from "@pickler/ui";
import { isEmail, PASSWORD_MIN, passwordScore } from "../lib/password";
import { ApiError, checkHandle, type HandleAvailability } from "../lib/pickler-api";
import { getSupabase } from "../lib/supabase-browser";
import { AuthHeader } from "./auth-header";
import { DoneView, type DoneState } from "./done-view";
import { SpawnBoard } from "./spawn-board";

type Method = "wallet" | "email";

const HANDLE_REASONS: Record<Exclude<HandleAvailability, { available: true }>["reason"], string> = {
  too_short: "Too short.",
  too_long: "15 characters at most.",
  invalid_characters: "Letters, numbers and underscores only.",
  reserved: "That handle is reserved.",
  taken: "is taken.",
};

const STRENGTH = [
  { label: "", className: undefined },
  { label: "WEAK", className: styles.bad },
  { label: "OK", className: styles.warn },
  { label: "STRONG", className: styles.good },
] as const;

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

export function SignUpFlow({
  board,
  completeProfile,
}: {
  board: AuthBoardData;
  completeProfile: boolean;
}) {
  const [step, setStep] = useState<1 | 2>(completeProfile ? 2 : 1);
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(completeProfile);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);

  const configured = isAuthConfigured();
  const score = passwordScore(password);
  const step1Ok = agreed && (method === "wallet" || (isEmail(email) && score > 0));
  const availability = useHandleCheck(handle);
  const handleOk = typeof availability === "object" && availability?.available === true;
  const step2Ok = name.trim().length > 1 && handleOk && configured && !busy;

  const handleNote: { text: string; tone: FieldTone } = (() => {
    if (!handle) {
      return { text: "3–15 characters, letters, numbers and underscores.", tone: "quiet" };
    }
    if (handle.length < 3) {
      return { text: "Too short.", tone: "warn" };
    }
    if (!configured) {
      return { text: "Handle checks are not connected in this environment.", tone: "warn" };
    }
    if (availability === null) {
      return { text: `Checking @${handle}…`, tone: "quiet" };
    }
    if (availability === "error") {
      return { text: "Could not check this handle. Try again.", tone: "warn" };
    }
    if (availability.available) {
      return { text: `@${handle} is available.`, tone: "good" };
    }
    return {
      text:
        availability.reason === "taken"
          ? `@${handle} is taken.`
          : HANDLE_REASONS[availability.reason],
      tone: "bad",
    };
  })();

  function finishWith(result: AccountResult, returning: boolean) {
    if (result.kind === "ready") {
      setDone({ kind: "ready", handle: result.profile.handle, returning });
    } else if (result.kind === "confirm_email") {
      setDone({ kind: "confirm_email", email: result.email });
    } else {
      setError("That handle was just claimed. Pick another one.");
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase || !step2Ok) {
      return;
    }
    setBusy(true);
    setError(null);
    const details = { displayName: name.trim(), handle };
    try {
      if (completeProfile) {
        finishWith(await ensureProfile(supabase, details), true);
      } else if (method === "email") {
        finishWith(await signUpWithEmail(supabase, { email, password, ...details }), false);
      } else {
        await signInWithWallet(supabase);
        finishWith(await ensureProfile(supabase, details), false);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "handle_taken") {
        setError(`@${handle} was just taken. Pick another one.`);
      } else if (caught instanceof ApiError && caught.code === "profile_exists") {
        setError("This account already has a profile. Sign in instead.");
      } else {
        setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <AuthHeader view="done" />
        <DoneView state={done} />
      </>
    );
  }

  return (
    <>
      <AuthHeader view="signup" />
      <main className={styles.signup}>
        <div className={styles.formColumn}>
          <p className={styles.eyebrow}>
            {completeProfile ? "FINISH YOUR PROFILE" : "CREATE YOUR ACCOUNT"}
          </p>
          <h1 className={styles.headline}>
            {step === 1
              ? "One account, as many agents as you can keep honest."
              : "Claim the name they will see."}
          </h1>
          <p className={styles.subhead}>
            {step === 1
              ? "Create your account and open the private research console. Research requires operator approval; no wallet or funds are needed."
              : "Choose your profile name and handle. Research stays private and is not published automatically."}
          </p>

          {!configured && (
            <p className={`${styles.alert} ${styles.info}`}>
              Sign-up is not connected in this environment yet. You can walk through the form, but
              no account will be created.
            </p>
          )}
          {error && (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          )}

          <ol className={styles.steps}>
            {(["Account", "Handle"] as const).map((label, i) => (
              <li
                key={label}
                className={`${styles.step} ${step === i + 1 ? styles.stepActive : ""}`}
                aria-current={step === i + 1 ? "step" : undefined}
              >
                <span>0{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>

          {step === 1 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (step1Ok) {
                  setStep(2);
                }
              }}
            >
              <div className={styles.methods} role="radiogroup" aria-label="Sign-up method">
                {(
                  [
                    {
                      key: "wallet",
                      icon: "wallet",
                      label: "Continue with a wallet",
                      note: "Wallet sign-in is not available in this staging.",
                    },
                    {
                      key: "email",
                      icon: "mail",
                      label: "Continue with email",
                      note: "Sign in to your private research workspace.",
                    },
                  ] as const
                ).map((option) => (
                  <Button
                    key={option.key}
                    variant="tile"
                    role="radio"
                    aria-checked={method === option.key}
                    className={styles.method}
                    disabled={option.key === "wallet"}
                    onClick={() => setMethod(option.key)}
                  >
                    <Icon name={option.icon} size={16} />
                    <span className={styles.methodText}>
                      <strong>{option.label}</strong>
                      <span>{option.note}</span>
                    </span>
                    {method === option.key && (
                      <Icon name="check" size={16} className={styles.check} />
                    )}
                  </Button>
                ))}
              </div>

              {method === "email" && (
                <div className={styles.card}>
                  <Field label="EMAIL">
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="you@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="PASSWORD">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={`At least ${PASSWORD_MIN} characters`}
                      minLength={PASSWORD_MIN}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </Field>
                  <div
                    className={`${styles.strength} ${STRENGTH[score].className ?? ""}`}
                    aria-live="polite"
                  >
                    <span className={styles.strengthBar}>
                      <span className={styles.strengthFill} style={{ width: `${score * 33.4}%` }} />
                    </span>
                    <span className={styles.strengthLabel}>{STRENGTH[score].label}</span>
                  </div>
                </div>
              )}

              <label className={styles.terms}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className={styles.box} aria-hidden="true">
                  {agreed && <Icon name="check" size={12} />}
                </span>
                <span className={styles.termsText}>
                  I understand this staging provides private research, not automatic betting or
                  public picks.
                </span>
              </label>

              <Button
                type="submit"
                className={`${styles.primary} ${styles.continue}`}
                disabled={!step1Ok}
                arrow
              >
                Continue
              </Button>
            </form>
          ) : (
            <form onSubmit={createAccount}>
              <div className={styles.card} style={{ gap: 14 }}>
                <Field label="YOUR NAME">
                  <Input
                    autoComplete="name"
                    placeholder="Ana Robles"
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </Field>
                <Field label="HANDLE" note={handleNote.text} tone={handleNote.tone}>
                  <Input
                    prefix="@"
                    mono
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="anarobles"
                    maxLength={15}
                    value={handle}
                    onChange={(e) =>
                      setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())
                    }
                    invalid={handleNote.tone === "bad"}
                    required
                  />
                </Field>
                <p className={styles.cardNote}>
                  This is the name on every pick your agents post. Agents get their own handle
                  later.
                </p>
              </div>

              <div className={styles.actions}>
                {!completeProfile && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`${styles.ghostButton} ${styles.back}`}
                    onClick={() => setStep(1)}
                  >
                    Back
                  </Button>
                )}
                <Button type="submit" className={styles.primary} disabled={!step2Ok} arrow>
                  {busy
                    ? method === "wallet" && !completeProfile
                      ? "Waiting for your wallet…"
                      : "Creating…"
                    : completeProfile
                      ? "Save profile"
                      : "Create account"}
                </Button>
              </div>
            </form>
          )}
        </div>

        <SpawnBoard board={board} />
      </main>
    </>
  );
}

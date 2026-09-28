"use client";

import { useState, type FormEvent } from "react";
import { BrandMark, Button, Input, Segmented } from "@pickler/ui";
import styles from "../../auth.module.css";
import { isEmail, sendEmailCode, signInWithProvider } from "../../lib/account";
import { authConfig, isAuthConfigured } from "../../lib/config";
import { getSupabase } from "../../lib/supabase-browser";

/** The two rails a person can choose; `recover` is entered, never picked. */
type Choice = "up" | "in";

const TITLES: Record<Choice, string> = { up: "JOIN THE BOARD", in: "GET IN" };

const OPTIONS = [
  { value: "up", label: "Sign up" },
  { value: "in", label: "Sign in" },
] as const;

/**
 * The first screen: pick a rail, then hand over an address. Both rails make the same call —
 * `sendEmailCode` creates the account if there is not one — so the toggle decides what happens
 * after the code, not what is sent.
 */
export function AccountStep({
  mode,
  email: initialEmail,
  onMode,
  onSent,
}: {
  mode: Choice;
  email: string;
  onMode: (mode: Choice) => void;
  onSent: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState<"google" | "twitter" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = isAuthConfigured();
  const canSend = isEmail(email) && configured && busy === null;

  async function run(kind: "google" | "twitter" | "email", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach Pickler. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase || !canSend) {
      return;
    }
    void run("email", async () => {
      await sendEmailCode(supabase, email);
      onSent(email.trim());
    });
  }

  function provider(name: "google" | "twitter") {
    const supabase = getSupabase();
    if (supabase) {
      // On success the browser leaves for the provider and never comes back here; /auth/callback
      // exchanges the code. So there is nothing to do after the await but report a failure.
      void run(name, () => signInWithProvider(supabase, name));
    }
  }

  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>{TITLES[mode]}</h1>

      {/* `ink`, not `lime`: which rail you are on is a view of the same form, not a side you
          are taking, and the canvas draws the chosen one as a plain white pill. */}
      <Segmented options={OPTIONS} value={mode} onChange={onMode} label="Sign up or sign in" />

      {!configured && (
        <p className={`${styles.alert} ${styles.info}`}>
          Sign-in is not connected in this environment yet. You can walk through the form, but no
          code will be sent.
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      <div className={styles.providers}>
        <Button
          variant="tile"
          className={styles.provider}
          disabled={!configured || busy !== null}
          onClick={() => provider("google")}
        >
          <BrandMark name="google" />
          Google
        </Button>
        {/* X needs credentials on the Supabase project. A button that cannot work is worse than
            no button, so it is absent until the environment says the provider is configured. */}
        {authConfig.xOAuthEnabled && (
          <Button
            variant="tile"
            className={styles.provider}
            disabled={!configured || busy !== null}
            onClick={() => provider("twitter")}
          >
            <BrandMark name="x" size={16} />X
          </Button>
        )}
      </div>

      <p className={styles.divider}>OR EMAIL</p>

      <form className={styles.emailRow} onSubmit={send}>
        <label>
          <span className={styles.srOnly}>Email</span>
          <Input
            type="email"
            shape="pill"
            size="lg"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <Button
          type="submit"
          className={`${styles.primary} ${styles.sendCode}`}
          disabled={!canSend}
        >
          {busy === "email" ? "Sending…" : "Send code"}
        </Button>
      </form>
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "../auth.module.css";
import { ensureProfile, signInWithWallet, type AccountResult } from "../lib/account";
import type { AuthBoardData } from "../lib/board-data";
import { isAuthConfigured } from "../lib/config";
import { Icon, Button, Input } from "@pickler/ui";
import { getSupabase } from "../lib/supabase-browser";
import { AuthHeader } from "./auth-header";
import { BoardNow } from "./board-now";
import { DoneView, type DoneState } from "./done-view";
import { FallingPieces } from "./falling-pieces";

export function SignInCard({ board }: { board: AuthBoardData }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"wallet" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const configured = isAuthConfigured();

  function after(result: AccountResult) {
    if (result.kind === "ready") {
      setDone({ kind: "ready", handle: result.profile.handle, returning: true });
    } else {
      router.push("/signup?complete=1");
    }
  }

  async function run(kind: "wallet" | "email", action: () => Promise<void>) {
    const supabase = getSupabase();
    if (!supabase) {
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      await action();
      after(await ensureProfile(supabase));
    } catch (caught) {
      // Supabase deliberately does not say whether the email exists.
      setError(caught instanceof Error ? caught.message : "Could not sign you in. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function signInWithEmail(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase) {
      return;
    }
    void run("email", async () => {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        throw new Error(authError.message);
      }
    });
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
      <AuthHeader view="signin" />
      <main className={styles.signin}>
        <div className={styles.signinGlow} aria-hidden="true" />
        <div className={styles.signinStars} aria-hidden="true" />
        <FallingPieces />
        <div className={styles.signinColumn}>
          <Image
            src="/brand/mascot.webp"
            alt=""
            width={1000}
            height={834}
            className={styles.mascotTop}
            priority
            unoptimized
          />
          <div className={styles.glassCard}>
            <h1 className={styles.cardTitle}>Welcome back</h1>
            <p className={styles.cardLead}>Sign in to review your private agents and research.</p>
            {!configured && (
              <p className={`${styles.alert} ${styles.info}`}>
                Sign-in is not connected in this environment yet.
              </p>
            )}
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
            <Button
              variant="tile"
              className={styles.walletButton}
              disabled
              onClick={() => {
                const supabase = getSupabase();
                if (supabase) {
                  void run("wallet", () => signInWithWallet(supabase));
                }
              }}
            >
              <Icon name={"wallet"} size={16} />
              {busy === "wallet"
                ? "Waiting for your wallet…"
                : "Wallet sign-in unavailable in staging"}
            </Button>
            <p className={styles.divider}>OR WITH EMAIL</p>
            <form className={styles.stack} onSubmit={signInWithEmail}>
              <label>
                <span className={styles.srOnly}>Email</span>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                <span className={styles.srOnly}>Password</span>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <Button
                type="submit"
                className={styles.primary}
                disabled={!configured || busy !== null || !email || !password}
              >
                {busy === "email" ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          <BoardNow board={board} />

          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/">THE BOARD</Link>
            <Link href="/tokens">TOKENS</Link>
            <span>PICKLER · 2026</span>
          </nav>
        </div>
      </main>
    </>
  );
}

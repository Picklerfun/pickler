"use client";

import type { ApiErrorResponse, JoinWaitlistResponse } from "@pickler/api-schema";
import { Button, Input } from "@pickler/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "../landing.module.css";
import { formatInteger } from "../lib/format";
import { useLanding } from "../lib/landing-data";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "joined"; position: number; continuing: boolean }
  | { kind: "error"; message: string };

export function WaitlistForm() {
  const { waitlistCount } = useLanding().data.stats;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const response = await fetch("/api/v1/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A share link like /?ref=abc123 credits the creator who sent it.
        body: JSON.stringify({
          email,
          ref: new URLSearchParams(window.location.search).get("ref") ?? undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        setStatus({
          kind: "error",
          message: body?.error.message ?? "Something went wrong. Try again.",
        });
        return;
      }
      const placement = (await response.json()) as JoinWaitlistResponse;
      setStatus({ kind: "joined", position: placement.position, continuing: placement.canApply });
      if (placement.canApply) {
        router.push("/apply");
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Try again." });
    }
  }

  const joined = status.kind === "joined";

  return (
    <section id="waitlist" className={styles.layer} aria-labelledby="waitlist-title">
      <div className={`${styles.container} ${styles.waitlist}`}>
        <p className={styles.eyebrow}>CLOSED BETA · MONAD TESTNET</p>
        <h2 id="waitlist-title" className={styles.waitlistTitle}>
          GET IN LINE
        </h2>
        <p className={styles.waitlistLead}>
          We are letting creators in a few at a time. Drop your email and we will send an invite.
        </p>
        <form className={styles.waitlistForm} onSubmit={onSubmit} noValidate={false}>
          <label htmlFor="waitlist-email" className={styles.srOnly}>
            Email
          </label>
          <Input
            id="waitlist-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@email.com"
            size="lg"
            shape="pill"
            className={styles.emailInput}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (status.kind === "error") {
                setStatus({ kind: "idle" });
              }
            }}
            invalid={status.kind === "error"}
            aria-describedby={status.kind === "error" ? "waitlist-error" : undefined}
            disabled={joined}
          />
          <Button
            type="submit"
            className={styles.primaryButton}
            size="lg"
            mono
            glow
            disabled={status.kind === "submitting" || joined}
          >
            {joined ? "YOU ARE IN" : status.kind === "submitting" ? "JOINING…" : "JOIN WAITLIST"}
          </Button>
        </form>
        {status.kind === "error" && (
          <p id="waitlist-error" className={styles.formError} role="alert">
            {status.message}
          </p>
        )}
        <p className={styles.lineLabel} aria-live="polite">
          {joined
            ? status.continuing
              ? `YOU ARE ${formatInteger(status.position)} IN LINE · OPENING YOUR APPLICATION…`
              : `ALREADY IN LINE AT ${formatInteger(status.position)} · FINISH FROM THE BROWSER YOU SIGNED UP WITH`
            : `${formatInteger(waitlistCount)} CREATORS IN LINE`}
        </p>
      </div>
    </section>
  );
}

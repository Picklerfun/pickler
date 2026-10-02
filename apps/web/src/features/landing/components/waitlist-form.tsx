"use client";

import type { ApiErrorResponse, JoinWaitlistResponse } from "@pickler/api-schema";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "../landing.module.css";
import { formatInteger } from "../lib/format";
import { useStudioUrl } from "@/features/site/studio-href";
import { useLanding } from "../lib/landing-data";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "joined"; position: number; continuing: boolean }
  | { kind: "error"; message: string };

/**
 * The page's one ask.
 *
 * The count under it is the snapshot's `waitlistCount` (the waitlist's real count, or null and
 * nothing shown when the API could not read it) before joining and the API's own `position`
 * after — not the count plus one. The canvas shows 1,204 becoming 1,205, which assumes nobody else
 * joined in between and that a placement can be worked out on the client; the endpoint answers with
 * the real one, including when the address was already in line.
 */
export function WaitlistForm() {
  const { waitlistCount } = useLanding().data.stats;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const router = useRouter();
  const apply = useStudioUrl("/apply");

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
        // `/apply` is a studio route and this form is on the marketplace landing, so from the
        // marketplace host it is another origin — which the app router cannot push to.
        if (apply.startsWith("/")) {
          router.push(apply);
        } else {
          window.location.assign(apply);
        }
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Try again." });
    }
  }

  const joined = status.kind === "joined";

  return (
    <section id="waitlist" className={styles.waitlist} aria-labelledby="waitlist-title">
      <h2 id="waitlist-title" className={styles.waitlistTitle}>
        GET IN LINE.
      </h2>
      <p className={styles.waitlistLead}>A few creators a week. Invites by email.</p>
      <form className={styles.waitlistForm} onSubmit={onSubmit}>
        <label htmlFor="waitlist-email" className={styles.srOnly}>
          Email
        </label>
        <input
          id="waitlist-email"
          className={styles.emailInput}
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status.kind === "error") {
              setStatus({ kind: "idle" });
            }
          }}
          aria-invalid={status.kind === "error"}
          aria-describedby={status.kind === "error" ? "waitlist-error" : undefined}
          disabled={joined}
        />
        {/* Inverted against the panel it sits on, the same way the bar's action is. */}
        <button
          type="submit"
          className={`${styles.invert} ${styles.submit}`}
          data-surface="dark"
          disabled={status.kind === "submitting" || joined}
        >
          {joined ? "You are in" : status.kind === "submitting" ? "Joining…" : "Join waitlist"}
        </button>
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
          : waitlistCount === null
            ? ""
            : `${formatInteger(waitlistCount)} ${waitlistCount === 1 ? "CREATOR" : "CREATORS"} IN LINE`}
      </p>
    </section>
  );
}

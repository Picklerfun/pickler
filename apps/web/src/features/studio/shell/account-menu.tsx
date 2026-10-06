"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon, Skeleton } from "@pickler/ui";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import { signOutAccount } from "@/features/auth/lib/account";
import studio from "../studio.module.css";
import styles from "./account-menu.module.css";

/** One account disclosure for every Studio header; the creator's handle is not the agent's. */
export function AccountMenu({
  handle,
  preview = false,
}: {
  handle: string | null;
  preview?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const profile = useRef<HTMLAnchorElement>(null);
  const username = useRef<HTMLSpanElement>(null);
  const signingOut = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Animate to the actual text width, so short handles use the full transition duration too.
  useEffect(() => {
    const label = username.current;
    const container = root.current;
    if (!label || !container) {
      return;
    }
    const measure = () => {
      container.style.setProperty(
        "--account-label-width",
        `${label.getBoundingClientRect().width}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, [handle]);

  useEffect(() => {
    if (!open) {
      return;
    }
    profile.current?.focus();
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function signOut() {
    if (preview || signingOut.current) {
      return;
    }
    signingOut.current = true;
    setBusy(true);
    setError("");
    try {
      await signOutAccount(getSupabase());
      router.replace("/signin");
      router.refresh();
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      ref={root}
      className={styles.wrap}
      data-account-menu
      data-open={open}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      {handle && (
        <span className={styles.username} aria-hidden="true">
          <span ref={username} className={styles.label}>
            @{handle}
          </span>
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={styles.trigger}
        aria-label={handle ? `Account, @${handle}` : "Account"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className={studio.swatch} aria-hidden="true">
          <i data-swatch="lime" />
          <i data-swatch="violet" />
          <i data-swatch="amber" />
          <i data-swatch="blue" />
        </span>
      </Button>
      {open && (
        <div className={styles.panel} id={id}>
          {handle && <p className={styles.identity}>@{handle}</p>}
          <Link
            ref={profile}
            href="/account?section=profile"
            className={styles.item}
            onClick={() => setOpen(false)}
          >
            <Icon name="user" size={16} />
            My profile
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className={styles.item}
            disabled={busy || preview}
            title={preview ? "Sign out is unavailable in a design preview." : undefined}
            onClick={() => void signOut()}
          >
            <Icon name="lock" size={16} />
            {busy ? <Skeleton shape="line" className={styles.loading} /> : "Sign out"}
          </Button>
          {busy && (
            <span className={styles.srOnly} role="status">
              Signing out
            </span>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

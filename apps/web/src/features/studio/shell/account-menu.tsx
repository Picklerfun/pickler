"use client";

import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";
import { useEffect, useRef, useState } from "react";
import { Button, Icon, Skeleton } from "@pickler/ui";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@pickler/ui/dropdown-menu";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import { signOutAccount } from "@/features/auth/lib/account";
import { profileFromStudio, type StudioReturnContext } from "./account-return";
import studio from "../studio.module.css";
import styles from "./account-menu.module.css";

/** One account disclosure for every Studio header; the creator's handle is not the agent's. */
export function AccountMenu({
  handle,
  preview = false,
  returnContext,
}: {
  handle: string | null;
  preview?: boolean;
  returnContext?: StudioReturnContext | undefined;
}) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const username = useRef<HTMLSpanElement>(null);
  const signingOut = useRef(false);
  const [profileHref, setProfileHref] = useState("/account?section=profile");
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
    <div ref={root} className={styles.wrap} data-account-menu data-open={open}>
      {handle && (
        <span className={styles.username} aria-hidden="true">
          <span ref={username} className={styles.label}>
            @{handle}
          </span>
        </span>
      )}
      <DropdownMenu
        modal={false}
        open={open}
        onOpenChange={(next) => {
          if (busy && !next) {
            return;
          }
          if (next) {
            setProfileHref(
              profileFromStudio(window.location.pathname, window.location.search, returnContext),
            );
          }
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={styles.trigger}
            aria-label={handle ? `Account, @${handle}` : "Account"}
          >
            <span className={studio.swatch} aria-hidden="true">
              <i data-swatch="lime" />
              <i data-swatch="violet" />
              <i data-swatch="amber" />
              <i data-swatch="blue" />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-surface="dark"
          className={styles.panel}
          align="end"
          sideOffset={10}
        >
          <DropdownMenuGroup>
            {handle && <DropdownMenuLabel className={styles.identity}>@{handle}</DropdownMenuLabel>}
            <DropdownMenuItem asChild>
              <Link href={profileHref} className={styles.item} onClick={() => setOpen(false)}>
                <Icon name="user" size={16} />
                My profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.item}
              disabled={busy || preview}
              title={preview ? "Sign out is unavailable in a design preview." : undefined}
              onSelect={(event) => {
                event.preventDefault();
                void signOut();
              }}
            >
              <Icon name="lock" size={16} />
              {busy ? <Skeleton shape="line" className={styles.loading} /> : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

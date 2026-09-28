"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button, ButtonLink, Icon } from "@pickler/ui";
import {
  SECOND_PASSKEY,
  hiddenThisSession,
  hideThisSession,
  suggestSecondPasskey,
  type PasskeysKnown,
} from "../lib/second-passkey";
import styles from "./second-passkey.module.css";

/** `window.sessionStorage`, or null where there is none; reading it can throw. */
function sessionStore() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/* The hide lives in session storage, which the server cannot read: the server renders "not
   hidden" and the browser corrects it after hydration, without a mismatch. A hide in this tab is
   announced so every callout on the page goes at once. */
const HIDE_EVENT = "pickler:second-passkey-hidden";
const subscribe = (changed: () => void) => {
  window.addEventListener(HIDE_EVENT, changed);
  return () => window.removeEventListener(HIDE_EVENT, changed);
};
const readHidden = () => hiddenThisSession(sessionStore());
const hiddenOnServer = () => false;

/**
 * "You have one passkey…", with the way to /passkey's add-device screen and a per-session "Not now".
 * Renders nothing unless `suggestSecondPasskey` says so for the list the screen already read.
 */
export function SecondPasskey({ passkeys, id }: { passkeys: PasskeysKnown; id: string }) {
  const hidden = useSyncExternalStore(subscribe, readHidden, hiddenOnServer);
  if (hidden || !suggestSecondPasskey(passkeys)) {
    return null;
  }
  return (
    <div className={styles.callout} id={id} role="note">
      <Icon name="key" size={16} />
      <p className={styles.text}>{SECOND_PASSKEY.text}</p>
      <div className={styles.actions}>
        <ButtonLink as={Link} href={SECOND_PASSKEY.href} variant="secondary" size="sm" arrow>
          {SECOND_PASSKEY.cta}
        </ButtonLink>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            hideThisSession(sessionStore());
            window.dispatchEvent(new Event(HIDE_EVENT));
          }}
        >
          {SECOND_PASSKEY.hide}
        </Button>
      </div>
    </div>
  );
}

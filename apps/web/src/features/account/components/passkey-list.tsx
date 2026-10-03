"use client";

import { Button } from "@pickler/ui";
import type { PasskeyDto } from "../../auth/lib/custody-api";
import { SecondPasskey } from "../../auth/components/second-passkey";
import { passkeyMeta, removalBlocked } from "../lib/passkeys";
import styles from "../account.module.css";

/** What the screen knows about this account's passkeys. `failed` is not an empty list. */
export type PasskeyState =
  { kind: "loading" } | { kind: "ready"; passkeys: PasskeyDto[] } | { kind: "failed" };

/**
 * The account's passkeys as rows: the second-passkey suggestion, the read's three states and one
 * row per passkey with its meta line and a Remove that stays shut (`removalBlocked` says which of
 * its two reasons applies). `/account`'s security section and the live studio's Account · Security
 * both draw it, so a passkey reads the same in either place.
 */
export function PasskeyList({
  state: read,
  secondPasskeyId,
  compact = false,
}: {
  state: PasskeyState;
  /** The suggestion's id: `account-second-passkey` on /account, the studio's own inside it. */
  secondPasskeyId: string;
  /** Rows without side padding, for a card of the rows' own colour (the live studio). */
  compact?: boolean;
}) {
  const listed = read.kind === "ready" ? read.passkeys : null;

  return (
    <>
      <SecondPasskey passkeys={read} id={secondPasskeyId} />
      {read.kind === "loading" && <p className={styles.rowMeta}>READING YOUR PASSKEYS…</p>}
      {read.kind === "failed" && (
        <p className={styles.rowMeta}>
          THIS LIST COULD NOT BE READ · YOUR PASSKEYS HAVE NOT CHANGED
        </p>
      )}
      {listed?.map((passkey) => (
        <div
          key={passkey.id}
          className={compact ? `${styles.row} ${styles.rowCompact}` : styles.row}
        >
          <span className={styles.passkeyMark} aria-hidden="true" />
          <div className={styles.rowText}>
            <p className={styles.rowTitle}>{passkey.label}</p>
            <p className={styles.rowMeta}>{passkeyMeta(passkey)}</p>
          </div>
          {/* Always disabled, with the title saying which of the two reasons applies. No route
              deletes a passkey, so nothing here could run — and the one-key rule is already in
              `removalBlocked` so that it is in place the day the route lands. */}
          <Button
            variant="ghost"
            size="sm"
            disabled
            title={removalBlocked(listed.length)}
            className={styles.remove}
          >
            Remove
          </Button>
        </div>
      ))}
      {listed?.length === 0 && <p className={styles.rowMeta}>NO PASSKEYS ON THIS ACCOUNT YET</p>}
    </>
  );
}

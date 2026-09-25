"use client";

import Link from "next/link";
import { Button, ButtonLink, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";
import type { PasskeyDto } from "../../lib/custody-api";
import { passkeyLine } from "../../lib/passkey-list";

/** What the screen knows about this account's passkeys. `failed` is not an empty list. */
export type PasskeysRead =
  { kind: "loading" } | { kind: "ready"; passkeys: PasskeyDto[] } | { kind: "failed" };

/**
 * `/passkey` for a signed-in person whose sub-organization already exists — the only ceremony
 * left to offer here, now that the first one lives entirely in the studio.
 */
export function AddPasskeyStep({
  passkeys,
  busy,
  onAdd,
  destination,
}: {
  passkeys: PasskeysRead;
  /** True while the sheet behind this screen is open, so a second prompt cannot be started. */
  busy: boolean;
  onAdd: () => void;
  /** Where "Done" goes — the studio, or wherever the guard turned this person away from. */
  destination: string;
}) {
  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>ADD A PASSKEY</h1>
      <p className={styles.subhead}>
        Every passkey on this account can move its funds. Add one from a phone, a security key or a
        password manager.
      </p>

      {passkeys.kind === "loading" && <p className={styles.flowLead}>READING YOUR PASSKEYS…</p>}
      {passkeys.kind === "failed" && (
        <p className={styles.flowLead}>
          THIS LIST COULD NOT BE READ · YOUR PASSKEYS HAVE NOT CHANGED
        </p>
      )}
      {passkeys.kind === "ready" && passkeys.passkeys.length === 0 && (
        <p className={styles.flowLead}>NO PASSKEYS ON THIS ACCOUNT YET</p>
      )}
      {passkeys.kind === "ready" && passkeys.passkeys.length > 0 && (
        <ul className={styles.points}>
          {passkeys.passkeys.map((passkey) => (
            <li key={passkey.id} className={styles.point}>
              <span className={styles.pointTitle}>{passkey.label}</span>
              <span className={styles.pointTag}>{passkeyLine(passkey)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.flowActions}>
        <Button className={styles.primary} onClick={onAdd} disabled={busy}>
          <Icon name="key" size={19} />
          Add a passkey
        </Button>
        <ButtonLink as={Link} href={destination} variant="secondary" arrow>
          Done
        </ButtonLink>
      </div>
    </div>
  );
}

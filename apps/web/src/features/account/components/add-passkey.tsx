"use client";

import { useState, type ReactElement } from "react";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import { PasskeySheet } from "../../auth/components/passkey-sheet";
import {
  CUSTODY_API,
  SessionExpired,
  addPasskey,
  describeCustodyFailure,
  openChallenge,
  type CustodyDeps,
} from "../../auth/lib/custody";
import type { ChallengeOptionsDto } from "../../auth/lib/custody-api";
import type { SheetPhase } from "../../auth/lib/sheet";
import { getSupabase } from "../../auth/lib/supabase-browser";

/** What a passkey added from this ceremony is called in the account's list. */
const BACKUP_LABEL = "Backup passkey";

/** Everything the reused auth sheet needs to draw itself, and the challenge behind it. */
interface SheetState {
  phase: SheetPhase;
  error: string | null;
  options: ChallengeOptionsDto | null;
  step?: 1 | 2;
}

const userAgent = () => (typeof navigator === "undefined" ? null : navigator.userAgent);

function custody(): CustodyDeps {
  return {
    // Read again on every call rather than carried across the prompt: supabase-js refreshes an
    // expired session as it hands the token over, and a prompt can sit on screen for minutes.
    token: async () => {
      const supabase = getSupabase();
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      if (!data.session) {
        throw new SessionExpired();
      }
      return data.session.access_token;
    },
    credentials: navigator.credentials,
    api: CUSTODY_API,
    stamp: (rpId, body) => new WebauthnStamper({ rpId }).stamp(body),
  };
}

/**
 * The account's add-a-device ceremony, for `/account`'s security section and the live studio's
 * Account · Security: `open()` shows the sheet and fetches the challenge behind it, and `sheet` is
 * the sheet itself, to be rendered once by the screen. `onAdded` runs once the passkey is on the
 * account (the studio reads its list again).
 */
export function useAddPasskey({ onAdded }: { onAdded?: () => void } = {}): {
  open(): void;
  sheet: ReactElement;
} {
  const [sheet, setSheet] = useState<SheetState | null>(null);

  /**
   * Opens the sheet and fetches the challenge behind it, so confirming reaches the operating system
   * without a network round trip in between — an awaited fetch there can spend the user activation
   * Safari requires for `credentials.create()`. Same ordering as features/auth and for the same
   * reason; lib/custody.ts is where both screens' ceremony actually lives.
   */
  function open() {
    const opening: SheetState = { phase: "busy", error: null, options: null };
    setSheet(opening);
    void (async () => {
      try {
        setSheet({ ...opening, phase: "idle", options: await openChallenge(custody()) });
      } catch (caught) {
        setSheet({ ...opening, phase: "error", error: describeCustodyFailure(caught) });
      }
    })();
  }

  function confirm() {
    const current = sheet;
    const options = current?.options;
    if (!current || !options) {
      return;
    }
    const running: SheetState = { ...current, phase: "busy", error: null };
    setSheet(running);
    void (async () => {
      try {
        await addPasskey(custody(), {
          options,
          // A second key belongs on something other than the device in your hand, which is what
          // "cross-platform" asks the operating system for.
          attachment: "cross-platform",
          label: BACKUP_LABEL,
          onStep: (step) => setSheet((now) => (now ? { ...now, step } : now)),
        });
        setSheet({ ...running, phase: "ok" });
        onAdded?.();
      } catch (caught) {
        setSheet({ ...running, phase: "error", error: describeCustodyFailure(caught) });
      }
    })();
  }

  return {
    open,
    /* The sheet from features/auth rather than a second one built here. It runs the ceremony this
       screen needs — `backup`, the one that puts a key on a phone or a security key — its copy is
       covered phase by phase in apps/web/test/sheet.test.ts, and it already carries the
       `data-surface="dark"` a body-level dialog needs, because a dialog is a child of the body,
       inherits no surface, and would otherwise fall through to the light default. A second dialog
       would be a third chance to forget that; the repository has forgotten it twice. */
    sheet: (
      <PasskeySheet
        open={sheet !== null}
        ceremony="backup"
        phase={sheet?.phase ?? "idle"}
        error={sheet?.error ?? null}
        rpId={sheet?.options?.rp.id ?? null}
        userAgent={userAgent()}
        onConfirm={confirm}
        onCancel={() => setSheet(null)}
        onRetry={open}
      />
    ),
  };
}

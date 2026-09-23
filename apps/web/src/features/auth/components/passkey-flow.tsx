"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import styles from "../auth.module.css";
import { ensureProfile } from "../lib/account";
import type { AuthBoardData } from "../lib/board-data";
import {
  CUSTODY_API,
  SessionExpired,
  addPasskey,
  alreadyEnrolled,
  createWallet,
  describeCustodyFailure,
  isEnrolledHere,
  landing,
  markEnrolled,
  openChallenge,
  type CustodyDeps,
} from "../lib/custody";
import { wallet as readWallet } from "../lib/custody-api";
import type { ChallengeOptionsDto, WalletDto } from "../lib/custody-api";
import { describeDevice } from "../lib/device";
import { INITIAL, next, rail } from "../lib/flow";
import { ApiError, getProfile } from "../lib/pickler-api";
import type { Ceremony, SheetPhase } from "../lib/sheet";
import { getSupabase } from "../lib/supabase-browser";
import { AuthHeader } from "./auth-header";
import { PasskeySheet } from "./passkey-sheet";
import { SpawnBoard } from "./spawn-board";
import { AccountStep } from "./steps/account-step";
import { CodeStep } from "./steps/code-step";
import { HandleStep } from "./steps/handle-step";
import { NewDeviceStep, RecoveredStep } from "./steps/new-device-step";
import { PasskeyStep } from "./steps/passkey-step";
import { WalletStep } from "./steps/wallet-step";
import { WelcomeStep } from "./steps/welcome-step";

/** What a backup is called in the account's list of passkeys; the device it lands on is not ours. */
const BACKUP_LABEL = "Backup passkey";

/** Where "Open the studio" goes from every screen that offers it. */
const STUDIO = "/console";

const userAgent = () => (typeof navigator === "undefined" ? null : navigator.userAgent);

/**
 * `window.localStorage`, or null where there is none. Reading the property itself throws in a
 * browser configured to refuse storage, which is why even this much is inside a try.
 */
function enrolmentStore() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // A browser that will not hand over storage is one this flow treats as never having enrolled.
    return null;
  }
}

/** Everything the sheet needs to draw itself, and the challenge the ceremony behind it will use. */
interface SheetState {
  ceremony: Ceremony;
  phase: SheetPhase;
  /** From `describeCustodyFailure`. Null in the error phase means the person dismissed the prompt. */
  error: string | null;
  /** Fetched while the sheet opens, so it can name the relying party before anyone agrees. */
  options: ChallengeOptionsDto | null;
  /** Which half of a two-ceremony run is going; only the `here` sheet shows it. */
  step?: 1 | 2;
}

/**
 * The form column and the board, with the flow machine driving which screen is in the column.
 *
 * The division of labour is the whole design here. A screen owns what only it does — sending a
 * code, verifying one, checking a handle — and holds its own busy and error while it does it. The
 * shell owns what crosses screens, which is the custody ceremony: it is the one piece of work
 * whose failure halfway through matters to a screen other than the one that started it, and it is
 * the reason `lib/custody.ts` exists rather than a `useCallback` here. This file is the wiring.
 */
export function PasskeyFlow({
  board,
  mode,
}: {
  board: AuthBoardData;
  /**
   * Which rail the route opens: `up` for /signup, `in` for /signin. It is the route's to give,
   * never defaulted here, because it is what decides whether a verified code goes on to the
   * handle screen or straight to welcome. `recover` is entered by `device_unknown`, never opened.
   */
  mode: "up" | "in";
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(next, { ...INITIAL, mode });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  /** Only ever the sign-in rail's: nothing reaches the welcome screen from the sign-up rail. */
  const [profileHandle, setProfileHandle] = useState("");
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const device = describeDevice(userAgent());

  /**
   * The access token and the person it belongs to. supabase-js refreshes an expired session as it
   * answers, so this is read again after every prompt rather than carried across one.
   */
  async function session() {
    const supabase = getSupabase();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    if (!data.session) {
      throw new SessionExpired();
    }
    return { token: data.session.access_token, userId: data.session.user.id };
  }

  function custody(): CustodyDeps {
    return {
      token: async () => (await session()).token,
      credentials: navigator.credentials,
      api: CUSTODY_API,
      stamp: (rpId, body) => new WebauthnStamper({ rpId }).stamp(body),
    };
  }

  /**
   * A ceremony that did not finish — including one the person dismissed, which is why the null
   * `describeCustodyFailure` answers for that is passed straight through rather than branched on.
   *
   * The sheet draws the difference: a sentence is a failure, and null is the cancelled state, which
   * says "Passkey cancelled" over "NOTHING WAS SIGNED · NOTHING MOVED" and shows no banner. Closing
   * quietly instead would be the wrong kindness here. Somebody who has just backed out of a prompt
   * in a custody flow is not asking what went wrong; they are asking whether anything happened to
   * their money, and an empty screen does not answer that.
   */
  function failed(current: SheetState, caught: unknown) {
    setSheet({ ...current, phase: "error", error: describeCustodyFailure(caught) });
  }

  /**
   * Opens the sheet and fetches the challenge behind it, so that confirming reaches the operating
   * system without a network round trip in between — an awaited fetch there can spend the user
   * activation Safari requires for `credentials.create()`.
   */
  function open(ceremony: Ceremony) {
    const opening: SheetState = { ceremony, phase: "busy", error: null, options: null };
    setSheet(opening);
    void (async () => {
      try {
        setSheet({ ...opening, phase: "idle", options: await openChallenge(custody()) });
      } catch (caught) {
        failed(opening, caught);
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
        await runCeremony(current.ceremony, options);
        setSheet({ ...running, phase: "ok" });
      } catch (caught) {
        // The new-device screen is shown on a hint that this browser holds no passkey. Refusing a
        // duplicate is the authenticator saying that hint was wrong, and it is the only thing in
        // reach that knows — so the mark is corrected and the person goes to the wallet they were
        // trying to reach. Telling them to "use the passkey you already have" on a screen that
        // offers no way to do so would be answering a question they did not ask with a dead end.
        if (current.ceremony === "here" && alreadyEnrolled(caught)) {
          await remember();
          dispatch({ type: "device_skipped" });
          setSheet(null);
          return;
        }
        failed(running, caught);
      }
    })();
  }

  /**
   * The mark that says this browser holds a passkey for this account, left after every ceremony
   * that finishes. Its own failure is swallowed: the ceremony has already succeeded by the time it
   * runs, and the worst a missing mark costs is the new-device screen on the next sign-in.
   */
  async function remember() {
    try {
      markEnrolled(enrolmentStore(), (await session()).userId);
    } catch {
      // A session that expired between the ceremony and this line changes nothing that happened.
    }
  }

  /**
   * The three ceremonies, and what each one tells the flow machine when it lands.
   *
   * Note what is not here: the address is handed to `passkey_created` and read back from
   * `state.address` afterwards. The register response carries it, but the screens have one copy
   * of it and this is the only line that puts it there.
   */
  async function runCeremony(ceremony: Ceremony, options: ChallengeOptionsDto) {
    if (ceremony === "create") {
      const created = await createWallet(custody(), { options, label: device });
      await remember();
      dispatch({ type: "passkey_created", address: created.address });
      return;
    }

    const backup = ceremony === "backup";
    await addPasskey(custody(), {
      options,
      // A backup goes on a phone or a security key, which is what "cross-platform" asks the
      // operating system for; a new device saves one on itself and the phone only stamps.
      attachment: backup ? "cross-platform" : "platform",
      label: backup ? BACKUP_LABEL : device,
      onStep: (step) => {
        setSheet((current) => (current ? { ...current, step } : current));
        if (!backup && step === 2) {
          // The rail moves to APPROVE as the phone is asked, not after it answers.
          dispatch({ type: "approve_started" });
        }
      },
    });
    await remember();
    dispatch(backup ? { type: "backup_added" } : { type: "device_added" });
  }

  /**
   * A verified code on the sign-in rail, where the next screen depends on what the account holds:
   * a name, a wallet, and whether this browser has ever made a passkey for it.
   *
   * The sign-up rail does none of this — it goes to the handle screen, which is what its own
   * `code_verified` does. Anything that cannot be read here falls through to the welcome screen,
   * which says plainly that it could not read the balance rather than guessing at a path.
   */
  function verified() {
    if (state.mode !== "in") {
      dispatch({ type: "code_verified" });
      return;
    }
    void (async () => {
      try {
        const { token, userId } = await session();
        const [handle, found] = await Promise.all([
          getProfile(token).then(
            (profile) => profile.handle,
            (error: unknown) => absent<string>(error),
          ),
          readWallet(token).then(
            (dto) => dto,
            (error: unknown) => absent<WalletDto>(error),
          ),
        ]);
        setWallet(found);
        setProfileHandle(handle ?? "");
        const enrolledHere = isEnrolledHere(enrolmentStore(), userId);
        switch (landing({ handle, wallet: found, enrolledHere })) {
          case "handle":
            // No profile yet: finish signing up rather than welcoming somebody to an empty account.
            dispatch({ type: "mode_chosen", mode: "up" });
            dispatch({ type: "code_verified" });
            return;
          case "passkey":
            dispatch({ type: "mode_chosen", mode: "up" });
            dispatch({ type: "code_verified" });
            dispatch({ type: "handle_claimed", handle: handle ?? "" });
            return;
          case "recover":
            dispatch({ type: "device_unknown" });
            return;
          case "welcome":
            dispatch({ type: "code_verified" });
            return;
        }
      } catch {
        dispatch({ type: "code_verified" });
      }
    })();
  }

  function claim(handle: string) {
    setClaiming(true);
    setClaimError(null);
    void (async () => {
      try {
        const supabase = getSupabase();
        if (!supabase) {
          throw new Error("Sign-up is not connected in this environment yet.");
        }
        // The display name is the handle until there is a screen that asks for another one.
        const result = await ensureProfile(supabase, { displayName: handle, handle });
        if (result.kind !== "ready") {
          setClaimError("That handle went in the moment before yours. Pick another.");
          return;
        }
        // The server's handle, not the typed one: an account that already had a profile keeps it.
        dispatch({ type: "handle_claimed", handle: result.profile.handle });
      } catch (caught) {
        setClaimError(caught instanceof Error ? caught.message : "Could not claim that handle.");
      } finally {
        setClaiming(false);
      }
    })();
  }

  const busy = sheet !== null;
  const phase: "idle" | "creating" | "verifying" =
    sheet?.ceremony === "here" && sheet.phase === "busy"
      ? sheet.step === 2
        ? "verifying"
        : "creating"
      : "idle";

  return (
    <>
      <AuthHeader />
      <main className={styles.signup}>
        <div className={styles.formColumn}>
          <ol className={styles.rail}>
            {rail(state).map((entry) => (
              <li
                key={entry.label}
                className={[
                  styles.railPhase,
                  entry.done ? styles.railDone : "",
                  entry.active ? styles.railActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={entry.active ? "step" : undefined}
              >
                <span className={styles.railBar} aria-hidden="true" />
                <span className={styles.railLabel}>{entry.label}</span>
              </li>
            ))}
          </ol>

          {state.step === "auth" && (
            <AccountStep
              mode={state.mode === "in" ? "in" : "up"}
              email={state.email}
              onMode={(chosen) => dispatch({ type: "mode_chosen", mode: chosen })}
              onSent={(email) => dispatch({ type: "code_sent", email })}
            />
          )}
          {state.step === "code" && (
            <CodeStep
              email={state.email}
              code={state.code}
              onCode={(code) => dispatch({ type: "code_changed", code })}
              onVerified={verified}
              onChangeEmail={() => dispatch({ type: "change_email" })}
            />
          )}
          {state.step === "handle" && (
            <HandleStep
              handle={state.handle}
              error={claimError}
              busy={claiming}
              onClaimed={claim}
            />
          )}
          {state.step === "passkey" && <PasskeyStep busy={busy} onCreate={() => open("create")} />}
          {state.step === "wallet" && state.address !== null && (
            <WalletStep
              address={state.address}
              deviceLabel={device}
              hasBackup={state.hasBackup}
              busy={busy}
              onAddBackup={() => open("backup")}
              onFinish={() => router.push(STUDIO)}
            />
          )}
          {state.step === "welcome" && <WelcomeStep handle={profileHandle} wallet={wallet} />}
          {/* One screen for both steps: `approve` is the same page with the rail moved on, and a
              form column that emptied itself behind the sheet would strand a failed ceremony. */}
          {(state.step === "recover" || state.step === "approve") && (
            <NewDeviceStep
              phase={phase}
              onUsePhone={() => open("here")}
              onOpenWallet={() => dispatch({ type: "device_skipped" })}
            />
          )}
          {state.step === "recovered" && <RecoveredStep onFinish={() => router.push(STUDIO)} />}
        </div>

        <SpawnBoard board={board} />
      </main>

      <PasskeySheet
        open={sheet !== null}
        ceremony={sheet?.ceremony ?? "create"}
        phase={sheet?.phase ?? "idle"}
        error={sheet?.error ?? null}
        rpId={sheet?.options?.rp.id ?? null}
        userAgent={userAgent()}
        step={sheet?.ceremony === "here" ? sheet.step : undefined}
        onConfirm={confirm}
        // A fresh challenge and back to the question: the one the ceremony failed on is spent or
        // expired either way, and confirming from the sheet is what keeps the prompt a click away.
        onRetry={() => sheet && open(sheet.ceremony)}
        onCancel={() => setSheet(null)}
      />
    </>
  );
}

/** A 404 from the profile or the wallet route is an ordinary state, not a failure. */
function absent<T>(error: unknown): T | null {
  if (error instanceof ApiError && error.status === 404) {
    return null;
  }
  throw error;
}

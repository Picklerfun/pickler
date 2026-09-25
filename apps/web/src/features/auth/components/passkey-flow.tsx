"use client";

import { useEffect, useReducer, useState } from "react";
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
  describeCustodyFailure,
  isEnrolledHere,
  landing,
  markEnrolled,
  openChallenge,
  passkeyScreenFor,
  type CustodyDeps,
  type PasskeyScreen,
} from "../lib/custody";
import { passkeys as readPasskeys, wallet as readWallet } from "../lib/custody-api";
import type { ChallengeOptionsDto, WalletDto } from "../lib/custody-api";
import { describeDevice } from "../lib/device";
import { INITIAL, next, rail } from "../lib/flow";
import { ApiError, getProfile } from "../lib/pickler-api";
import type { Ceremony, SheetPhase } from "../lib/sheet";
import { useStudioHref } from "@/features/site/studio-href";
import { getSupabase } from "../lib/supabase-browser";
import { AuthHeader } from "./auth-header";
import { PasskeySheet } from "./passkey-sheet";
import { SpawnBoard } from "./spawn-board";
import { AccountStep } from "./steps/account-step";
import { AddPasskeyStep, type PasskeysRead } from "./steps/add-passkey-step";
import { CodeStep } from "./steps/code-step";
import { HandleStep } from "./steps/handle-step";
import { NewDeviceStep, RecoveredStep } from "./steps/new-device-step";
import { NoneYetStep } from "./steps/none-yet-step";
import { WelcomeStep } from "./steps/welcome-step";

/** What a second passkey is called in the account's list, wherever this file adds one. */
const BACKUP_LABEL = "Backup passkey";

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

/**
 * The access token and the person it belongs to. supabase-js refreshes an expired session as it
 * answers, so this is read again after every prompt rather than carried across one. Shared by
 * both flows below: neither closes over component state to get it.
 */
async function session(): Promise<{ token: string; userId: string }> {
  const supabase = getSupabase();
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  if (!data.session) {
    throw new SessionExpired();
  }
  return { token: data.session.access_token, userId: data.session.user.id };
}

/** Every ceremony either flow below runs is stamped the same way, against the same token. */
function custody(): CustodyDeps {
  return {
    token: async () => (await session()).token,
    credentials: navigator.credentials,
    api: CUSTODY_API,
    stamp: (rpId, body) => new WebauthnStamper({ rpId }).stamp(body),
  };
}

/** A 404 from the profile or the wallet route is an ordinary state, not a failure. */
function absent<T>(error: unknown): T | null {
  if (error instanceof ApiError && error.status === 404) {
    return null;
  }
  throw error;
}

/**
 * The form column and the board, on whichever of the two flows the route asked for.
 *
 * `add` — /passkey — is not this file's sign-up/sign-in machine at all. It used to be: the
 * enrolment ceremony that creates a sub-organization lived behind a `custody` mode of the same
 * `useReducer` this file still runs for `up`/`in`. Under the studio-create-and-fund specification
 * a sub-organization is born in exactly one place — the first agent's "Create and run it once",
 * in `features/studio/create/ceremony.ts` — so that mode is gone from `lib/flow.ts`, and `add` is
 * routed to `PasskeyAddFlow`, a smaller component with no rail and no `handle_claimed` to trip
 * over. See that component and `NoneYetStep` for what is left for a person with no sub-organization
 * yet to do here: nothing that starts one.
 */
export function PasskeyFlow({
  board,
  mode,
  destination,
}: {
  board: AuthBoardData;
  /** Which screen the route opens: `up` for /signup, `in` for /signin, `add` for /passkey. */
  mode: "up" | "in" | "add";
  /**
   * Where every screen that offers a way out of this flow goes. The route supplies it from the
   * `next` the guard wrote when it turned an anonymous request away, already checked by `returnTo`
   * — someone bounced from /account has to come back to /account, not be dropped on the studio.
   * Undefined when nobody was turned away, and then the studio's own home is the destination.
   */
  destination?: string | undefined;
}) {
  if (mode === "add") {
    return <PasskeyAddFlow board={board} destination={destination} />;
  }
  return <SignFlow board={board} mode={mode} destination={destination} />;
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
 * The sign-up and sign-in rail: `create/code/handle/welcome` and its sign-in-only cousin, plus
 * the new-device recovery rail entered from either. No ceremony here can create a
 * sub-organization — that moved to the studio — so the only ceremony this component ever opens is
 * `here`, the one that lends a browser that has never seen the account a passkey for it.
 *
 * The division of labour is the whole design here. A screen owns what only it does — sending a
 * code, verifying one, checking a handle — and holds its own busy and error while it does it. The
 * shell owns what crosses screens, which is the new-device ceremony: it is the one piece of work
 * whose failure halfway through matters to a screen other than the one that started it.
 */
function SignFlow({
  board,
  mode,
  destination,
}: {
  board: AuthBoardData;
  mode: "up" | "in";
  destination?: string | undefined;
}) {
  const router = useRouter();
  const studio = useStudioHref();
  const target = destination ?? studio;
  const [state, dispatch] = useReducer(next, { ...INITIAL, mode });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  /** Only ever the sign-in rail's: nothing reaches the welcome screen from the sign-up rail. */
  const [profileHandle, setProfileHandle] = useState("");
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const device = describeDevice(userAgent());

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
        await runCeremony(options);
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
   * The one ceremony this flow can still open: lending a browser that holds no passkey for the
   * account one, the second half of "use my phone" on the new-device rail. `open` is only ever
   * called with `"here"`, so this needs no ceremony of its own to branch on.
   */
  async function runCeremony(options: ChallengeOptionsDto) {
    await addPasskey(custody(), {
      options,
      attachment: "platform",
      label: device,
      onStep: (step) => {
        setSheet((current) => (current ? { ...current, step } : current));
        if (step === 2) {
          // The rail moves to APPROVE as the phone is asked, not after it answers.
          dispatch({ type: "approve_started" });
        }
      },
    });
    await remember();
    dispatch({ type: "device_added" });
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
            // No wallet yet either — a sub-organization is only ever born in the studio now, so
            // this account belongs on the studio's own door to that rather than on a screen here.
            dispatch({ type: "code_verified" });
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
          {state.step === "welcome" && (
            <WelcomeStep handle={profileHandle} wallet={wallet} destination={target} />
          )}
          {/* One screen for both steps: `approve` is the same page with the rail moved on, and a
              form column that emptied itself behind the sheet would strand a failed ceremony. */}
          {(state.step === "recover" || state.step === "approve") && (
            <NewDeviceStep
              phase={phase}
              onUsePhone={() => open("here")}
              onOpenWallet={() => dispatch({ type: "device_skipped" })}
            />
          )}
          {state.step === "recovered" && <RecoveredStep onFinish={() => router.push(target)} />}
        </div>

        <SpawnBoard board={board} />
      </main>

      <PasskeySheet
        open={sheet !== null}
        ceremony={sheet?.ceremony ?? "here"}
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

/** What `PasskeyAddFlow` has read about the account, before it can choose a screen. */
type AddFlowScreen = "loading" | "error" | PasskeyScreen;

/** The ceremony sheet `PasskeyAddFlow` runs, always the same one: adding a second passkey. */
interface AddSheetState {
  phase: SheetPhase;
  error: string | null;
  options: ChallengeOptionsDto | null;
  step?: 1 | 2;
}

/**
 * `/passkey`, reached only by a signed-in person.
 *
 * There is exactly one thing this screen can do that the studio cannot: add another passkey to a
 * sub-organization that already exists, and show which ones are on it. It cannot create one — see
 * `PasskeyFlow`'s own comment for where that ceremony lives now — so the first read this component
 * makes decides which of two screens to draw, via the same signal `landing` reads for sign-in:
 * GET /wallets/me, where a 404 means there is no sub-organization yet.
 */
function PasskeyAddFlow({
  board,
  destination,
}: {
  board: AuthBoardData;
  destination?: string | undefined;
}) {
  const studio = useStudioHref();
  const target = destination ?? studio;
  const [screen, setScreen] = useState<AddFlowScreen>("loading");
  const [passkeysState, setPasskeysState] = useState<PasskeysRead>({ kind: "loading" });
  const [sheet, setSheet] = useState<AddSheetState | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { token } = await session();
        const [found, keys] = await Promise.all([
          readWallet(token).then(
            (value) => value,
            (error: unknown) => absent<WalletDto>(error),
          ),
          readPasskeys(token).then(
            (value): PasskeysRead => ({ kind: "ready", passkeys: value }),
            (): PasskeysRead => ({ kind: "failed" }),
          ),
        ]);
        if (!live) {
          return;
        }
        setScreen(passkeyScreenFor({ hasSubOrganization: found !== null }));
        setPasskeysState(keys);
      } catch {
        if (live) {
          setScreen("error");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  /** Re-reads the list after a passkey is added, the same failed-read-is-not-empty rule as above. */
  function refreshPasskeys() {
    void (async () => {
      try {
        const { token } = await session();
        const keys = await readPasskeys(token);
        setPasskeysState({ kind: "ready", passkeys: keys });
      } catch {
        setPasskeysState({ kind: "failed" });
      }
    })();
  }

  function openSheet() {
    const opening: AddSheetState = { phase: "busy", error: null, options: null };
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
    const running: AddSheetState = { ...current, phase: "busy", error: null };
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
        try {
          markEnrolled(enrolmentStore(), (await session()).userId);
        } catch {
          // The ceremony already succeeded; a session that expired on this last read changes
          // nothing it did.
        }
        setSheet({ ...running, phase: "ok" });
        refreshPasskeys();
      } catch (caught) {
        setSheet({ ...running, phase: "error", error: describeCustodyFailure(caught) });
      }
    })();
  }

  return (
    <>
      <AuthHeader />
      <main className={styles.signup}>
        <div className={styles.formColumn}>
          {screen === "loading" && <p className={styles.flowLead}>READING YOUR ACCOUNT…</p>}
          {screen === "error" && (
            <p className={styles.flowLead}>YOUR ACCOUNT COULD NOT BE READ · RELOAD TO TRY AGAIN</p>
          )}
          {screen === "none-yet" && <NoneYetStep />}
          {screen === "add" && (
            <AddPasskeyStep
              passkeys={passkeysState}
              busy={sheet !== null}
              onAdd={openSheet}
              destination={target}
            />
          )}
        </div>

        <SpawnBoard board={board} />
      </main>

      <PasskeySheet
        open={sheet !== null}
        ceremony="backup"
        phase={sheet?.phase ?? "idle"}
        error={sheet?.error ?? null}
        rpId={sheet?.options?.rp.id ?? null}
        userAgent={userAgent()}
        onConfirm={confirm}
        onRetry={openSheet}
        onCancel={() => setSheet(null)}
      />
    </>
  );
}

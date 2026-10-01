"use client";

import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import styles from "../auth.module.css";
import { ensureProfile } from "../lib/account";
import type { AuthBoardData } from "../lib/board-data";
import { arrivalFor, type SignupPreview } from "../lib/signup-entry";
import { PREVIEW_PASSKEYS, type PasskeyPreview } from "../lib/passkey-entry";
import {
  CUSTODY_API,
  SessionExpired,
  addPasskey,
  alreadyEnrolled,
  createWallet,
  afterFailedCreate,
  describeCustodyFailure,
  enrolmentOutcome,
  isEnrolledHere,
  markEnrolled,
  openChallenge,
  readSubOrganization,
  redirectFor,
  verifiedEvent,
  type CustodyDeps,
} from "../lib/custody";
import { passkeys as readPasskeys, wallet as readWallet } from "../lib/custody-api";
import type { ChallengeOptionsDto, PasskeyDto, WalletDto } from "../lib/custody-api";
import { describeDevice } from "../lib/device";
import { INITIAL, next, rail, welcomeTitle } from "../lib/flow";
import { ApiError, getProfile } from "../lib/pickler-api";
import { Button } from "@pickler/ui";
import type { Ceremony, SheetPhase } from "../lib/sheet";
import { useStudioHref } from "@/features/site/studio-href";
import { getSupabase } from "../lib/supabase-browser";
import { AuthHeader } from "./auth-header";
import { PasskeySheet } from "./passkey-sheet";
import { SecondPasskey } from "./second-passkey";
import type { PasskeysKnown } from "../lib/second-passkey";
import { SpawnBoard } from "./spawn-board";
import { AccountStep } from "./steps/account-step";
import { AddPasskeyStep, type PasskeysRead } from "./steps/add-passkey-step";
import { CodeStep } from "./steps/code-step";
import { CreateWalletStep } from "./steps/create-wallet-step";
import { HandleStep } from "./steps/handle-step";
import { NewDeviceStep, RecoveredStep } from "./steps/new-device-step";
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

/** The account's passkeys, or null when the list could not be read — never `[]` for a failure. */
async function passkeyList(): Promise<PasskeyDto[] | null> {
  try {
    return await readPasskeys((await session()).token);
  } catch {
    return null;
  }
}

/**
 * After a create ceremony failed: the wallet, if the sub-organization exists now anyway (another
 * tab finished, and this one's authenticator refused a duplicate), else null. A read that fails is
 * "no" here — the step stays, with its retry.
 */
async function walletAfterFailedCreate(): Promise<WalletDto | null> {
  try {
    const now = await readSubOrganization(async () => readWallet((await session()).token));
    return afterFailedCreate(now !== null) === "advance" ? now : null;
  } catch {
    return null;
  }
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
 * `up` and `in` — /signup and /signin — run `lib/flow.ts`'s machine, whose sign-up rail puts the
 * mandatory passkey step straight after the code and the handle after it, and whose sign-in rail
 * passes through the passkey step when the account has no sub-organization (spec §4.1). Every
 * signed-in screen sends a person without a master wallet to the signup's passkey step
 * (`?step=passkey`), and one with a wallet and no profile to its handle step (`?step=handle`);
 * both resume their session from what the account holds, whatever the query says.
 * `add` — /passkey — is `PasskeyAddFlow`, a smaller component with no rail, only for adding a
 * device to a sub-organization that exists.
 */
export function PasskeyFlow({
  board,
  mode,
  destination,
  preview,
  passkeyPreview,
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
  /** `up` only, outside production: open on this step without a session or any read. */
  preview?: SignupPreview | undefined;
  /** `add` only, outside production: the add-a-passkey screen without a session or any read. */
  passkeyPreview?: PasskeyPreview | undefined;
}) {
  if (mode === "add") {
    return <PasskeyAddFlow board={board} destination={destination} preview={passkeyPreview} />;
  }
  return (
    <SignFlow
      board={board}
      mode={mode}
      destination={destination}
      preview={mode === "up" ? preview : undefined}
    />
  );
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
 * The sign-up and sign-in rail: `auth/code/passkey/handle/welcome` and its sign-in cousin, plus
 * the new-device recovery rail entered from either. Two ceremonies open from here: `create`, the
 * mandatory passkey step's enrolment (challenge → WebAuthn → register), which creates the
 * sub-organization and its master wallet; and `here`, which lends a browser that has never seen
 * the account a passkey for it.
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
  preview,
}: {
  board: AuthBoardData;
  mode: "up" | "in";
  destination?: string | undefined;
  preview: SignupPreview | undefined;
}) {
  const router = useRouter();
  const studio = useStudioHref();
  const target = destination ?? studio;
  // A preview opens on its step with nothing read; everything else starts on the account screen,
  // and a resumed session moves on from there once the account has been read.
  const [state, dispatch] = useReducer(
    next,
    preview === "passkey" ? { ...INITIAL, mode, step: "passkey" as const } : { ...INITIAL, mode },
  );
  /**
   * Until the session is known, the form column waits rather than asking for an email: a session
   * that already exists is resumed (`arrivalFor`), and only without one does the form appear.
   */
  const [resuming, setResuming] = useState(preview === undefined);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  /** The profile's handle from the landing check or the handle step; empty while there is none. */
  const [profileHandle, setProfileHandle] = useState("");
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  /** A `create` ceremony on the passkey step ended without a wallet; the step offers it again. */
  const [createFailed, setCreateFailed] = useState(false);
  /**
   * The passkey list read right after the create ceremony, reused for the welcome screen's
   * second-passkey suggestion. Loading everywhere else, which suggests nothing.
   */
  const [createdPasskeys, setCreatedPasskeys] = useState<PasskeysKnown>({ kind: "loading" });
  /** The account could not be read after a verified code; the code screen says so, with a retry. */
  const [readFailed, setReadFailed] = useState(false);

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
    if (current.ceremony === "create") {
      setCreateFailed(true);
    }
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
        const orphan = await runCeremony(current.ceremony, options);
        setSheet(orphan ? null : { ...running, phase: "ok" });
      } catch (caught) {
        // A failed create is not always a missing wallet: another tab may have finished signup
        // meanwhile, and this authenticator then refuses a duplicate through excludeCredentials.
        // "Try again" would fail the same way for ever, so the account is read again first.
        if (current.ceremony === "create") {
          const now = await walletAfterFailedCreate();
          if (now) {
            setWallet(now);
            setCreateFailed(false);
            setSheet(null);
            dispatch({ type: "passkey_created", profile: profileHandle !== "" });
            return;
          }
        }
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
   * The ceremony behind a confirmed sheet. `credentials.create()` is the first thing either one
   * awaits: the challenge was fetched when the sheet opened, so the click on the sheet's confirm
   * is still the user activation Safari requires when the prompt is raised.
   */
  async function runCeremony(ceremony: Ceremony, options: ChallengeOptionsDto): Promise<boolean> {
    if (ceremony === "create") {
      const created = await createWallet(custody(), { options, label: device });
      setCreateFailed(false);
      // `register` answers an account another tab created as readily as the one this call made.
      // Only a credential the account actually holds marks this browser enrolled; one it does not
      // hold authorises nothing, so the person goes to /passkey, whose add-device screen lists
      // what the account really has and can add this device properly.
      const list = await passkeyList();
      setCreatedPasskeys(list ? { kind: "ready", passkeys: list } : { kind: "failed" });
      const outcome = enrolmentOutcome(created.credentialId, list);
      if (outcome === "orphan") {
        router.push("/passkey");
        return true;
      }
      if (outcome === "enrolled") {
        await remember();
      }
      // On to the handle step, or to welcome for an account that already has a profile.
      dispatch({ type: "passkey_created", profile: profileHandle !== "" });
      // The welcome screen's balance. A read that fails leaves it saying so; the wallet exists.
      try {
        setWallet(await readWallet((await session()).token));
      } catch {
        setWallet(null);
      }
      return false;
    }
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
    return false;
  }

  /**
   * A verified code, where the next screen depends on what the account holds: a sub-organization,
   * a name, and whether this browser has ever made a passkey for it. Both rails read it: sign-in so
   * that an account without a sub-organization goes through the passkey step, sign-up so that an
   * account that is already complete is not asked to create a second passkey for a wallet it has.
   *
   * A 404 is an answer (`verifiedEvent` turns it into the next step). Any other failure is not,
   * so the code screen says the account could not be read and offers to read it again.
   */
  function verified() {
    readAccount();
  }

  /* Every arrival without a preview reads the session once: `readAccount` resumes one that exists
     and shows the email form otherwise. An effect event, so the read sees the current state
     without the effect re-running as it changes. */
  const resumeOnArrival = useEffectEvent(() => {
    if (resuming) {
      readAccount();
    }
  });
  useEffect(() => {
    resumeOnArrival();
  }, []);

  /**
   * The landing check, shared by a verified code and a resumed session: the same reads, the same
   * `verifiedEvent`. A resumed session with no session behind it after all starts at the account
   * screen like any other signup.
   */
  function readAccount() {
    setReadFailed(false);
    void (async () => {
      try {
        let signedIn: { token: string; userId: string } | null;
        try {
          signedIn = await session();
        } catch (caught) {
          if (!(caught instanceof SessionExpired)) {
            throw caught;
          }
          signedIn = null;
        }
        // Only an arrival turns "no session" into the email form. After a verified code there must
        // be one, and its absence is a failure the screen reports like any other.
        if (resuming && arrivalFor({ preview, signedIn: signedIn !== null }) === "form") {
          setResuming(false);
          return;
        }
        if (!signedIn) {
          throw new SessionExpired();
        }
        const { token, userId } = signedIn;
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
        dispatch(verifiedEvent({ handle, wallet: found, enrolledHere }));
        setResuming(false);
      } catch {
        // Not a welcome: a wallet that could not be read may be a missing one, and guessing would
        // let a person without a sub-organization past the passkey step. The code is verified and
        // the session stands, so trying again only reads the account again.
        setReadFailed(true);
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
        setProfileHandle(result.profile.handle);
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

          {resuming && !readFailed && <p className={styles.flowLead}>READING YOUR ACCOUNT…</p>}
          {resuming && readFailed && (
            <div className={styles.flowActions}>
              <p className={styles.alert} role="alert">
                Your account could not be read just now. Nothing was created.
              </p>
              <Button className={styles.primary} onClick={readAccount}>
                Try again
              </Button>
            </div>
          )}
          {!resuming && state.step === "auth" && (
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
          {state.step === "code" && readFailed && (
            <div className={styles.flowActions}>
              <p className={styles.alert} role="alert">
                Your code is right, but your account could not be read just now. Nothing was
                created.
              </p>
              <Button className={styles.primary} onClick={verified}>
                Try again
              </Button>
            </div>
          )}
          {state.step === "handle" && (
            <HandleStep
              handle={state.handle}
              error={claimError}
              busy={claiming}
              onClaimed={claim}
            />
          )}
          {state.step === "passkey" && (
            <CreateWalletStep
              busy={sheet !== null}
              retry={createFailed}
              onCreate={() => open("create")}
            />
          )}
          {state.step === "welcome" && (
            <WelcomeStep
              title={welcomeTitle(state)}
              handle={profileHandle}
              wallet={wallet}
              destination={target}
            />
          )}
          {state.step === "welcome" && (
            <SecondPasskey passkeys={createdPasskeys} id="welcome-second-passkey" />
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
        // Closing the sheet on the passkey step leaves the person on it: there is no way past the
        // step but a wallet, so a sheet closed before one exists counts as an attempt to retry.
        onCancel={() => {
          if (sheet?.ceremony === "create" && sheet.phase !== "ok") {
            setCreateFailed(true);
          }
          setSheet(null);
        }}
      />
    </>
  );
}

/** What `PasskeyAddFlow` has read about the account. */
type AddFlowScreen = "loading" | "error" | "add";

/** The ceremony sheet `PasskeyAddFlow` runs, always the same one: adding another passkey. */
interface AddSheetState {
  phase: SheetPhase;
  error: string | null;
  options: ChallengeOptionsDto | null;
  step?: 1 | 2;
}

/**
 * `/passkey`, reached only by a signed-in person, and only ever for adding a device: another
 * passkey on a sub-organization that exists, and the list of what is on it.
 *
 * A person without a sub-organization does not get in here, or anywhere: the first read
 * (GET /wallets/me, a 404 is none) sends them through `redirectFor` to the signup's own passkey
 * step, which is where the master wallet is created and where they stay until it is. One with a
 * wallet and no profile (GET /profile, a 404) is sent to the signup's handle step the same way.
 */
function PasskeyAddFlow({
  board,
  destination,
  preview,
}: {
  board: AuthBoardData;
  destination?: string | undefined;
  preview: PasskeyPreview | undefined;
}) {
  const router = useRouter();
  const studio = useStudioHref();
  const target = destination ?? studio;
  // A preview opens on the screen with its fixture list and reads nothing.
  const [screen, setScreen] = useState<AddFlowScreen>(preview === "add" ? "add" : "loading");
  const [passkeysState, setPasskeysState] = useState<PasskeysRead>(
    preview === "add" ? { kind: "ready", passkeys: PREVIEW_PASSKEYS } : { kind: "loading" },
  );
  const [sheet, setSheet] = useState<AddSheetState | null>(null);

  useEffect(() => {
    if (preview !== undefined) {
      return;
    }
    let live = true;
    void (async () => {
      try {
        const { token } = await session();
        const [found, profile, keys] = await Promise.all([
          readSubOrganization(() => readWallet(token)),
          // A 404 is no profile; any other failure decides nothing, so it is not null.
          getProfile(token).then(
            (value) => value,
            (error: unknown) =>
              error instanceof ApiError && error.status === 404 ? null : undefined,
          ),
          readPasskeys(token).then(
            (value): PasskeysRead => ({ kind: "ready", passkeys: value }),
            (): PasskeysRead => ({ kind: "failed" }),
          ),
        ]);
        if (!live) {
          return;
        }
        const away = redirectFor({ wallet: found, profile });
        if (away) {
          router.replace(away);
          return;
        }
        setScreen("add");
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
  }, [router, preview]);

  /** Re-reads the list after a passkey is added, the same failed-read-is-not-empty rule as above. */
  function refreshPasskeys() {
    void (async () => {
      const keys = await passkeyList();
      setPasskeysState(keys ? { kind: "ready", passkeys: keys } : { kind: "failed" });
    })();
  }

  /** Opens the sheet and fetches its challenge first, so confirming reaches WebAuthn directly. */
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

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import { MONAD_TESTNET } from "@pickler/chain";
import { PasskeySheet } from "../auth/components/passkey-sheet";
import {
  CUSTODY_API,
  SessionExpired,
  addPasskey,
  describeCustodyFailure,
  openChallenge,
  type CustodyDeps,
} from "../auth/lib/custody";
import { wallet as readWallet, type ChallengeOptionsDto } from "../auth/lib/custody-api";
import { describeDevice } from "../auth/lib/device";
import { ApiError, getProfile, type ProfileDto } from "../auth/lib/pickler-api";
import type { SheetPhase } from "../auth/lib/sheet";
import { getSupabase } from "../auth/lib/supabase-browser";
import { coverage } from "./lib/coverage";
import { accountPreview } from "./lib/preview";
import { SECTIONS, type SectionKey } from "./lib/sections";
import { ProfileSection } from "./sections/profile";
import { SecuritySection } from "./sections/security";
import { WalletSection, type WalletState } from "./sections/wallet";
import styles from "./account.module.css";

/** What a passkey added from this screen is called in the account's list. */
const BACKUP_LABEL = "Backup passkey";

/**
 * How many passkeys this account has, which nothing in this build can answer.
 *
 * A named constant rather than a literal null threaded through three components, because it is the
 * single fact the whole security section turns on and the day a route lists them this is the one
 * line that changes. lib/coverage.ts holds the reasoning and the two near-misses.
 */
const PASSKEY_COUNT: number | null = null;

/** Everything the reused auth sheet needs to draw itself, and the challenge behind it. */
interface SheetState {
  phase: SheetPhase;
  error: string | null;
  options: ChallengeOptionsDto | null;
  step?: 1 | 2;
}

const userAgent = () => (typeof navigator === "undefined" ? null : navigator.userAgent);

/* The page's own origin, which only the browser has. It is read through useSyncExternalStore rather
 * than set from an effect so that the server renders the empty string and the client renders the
 * origin without a second pass, and so that nothing in this file calls setState synchronously
 * inside an effect. The store never changes, so `subscribe` has nothing to do — both functions are
 * module level because a new reference each render would make React resubscribe every time. */
const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const originOnServer = () => "";

/** The 2×2 accent mark that stands for the person, in the top bar and on the profile. */
/* A CSS module class is `string | undefined` under this repo's tsconfig, which is why the prop
   says so rather than making the one caller assert. */
function Mark({ className }: { className: string | undefined }) {
  return (
    <span className={className} aria-hidden="true">
      <span className={styles.square} data-tint="lime" />
      <span className={styles.square} data-tint="violet" />
      <span className={styles.square} data-tint="amber" />
      <span className={styles.square} data-tint="blue" />
    </span>
  );
}

export function Account({ opening }: { opening: SectionKey }) {
  const [section, setSection] = useState<SectionKey>(opening);
  /**
   * The fixture, decided once at the first render rather than from an effect.
   *
   * It reads only `process.env.NODE_ENV` and the two NEXT_PUBLIC values, all of which are inlined
   * identically into the server and the browser bundle — so both renders agree and there is no
   * hydration pass to mismatch. Holding it also means "this came from a fixture" is a fact rather
   * than something inferred later: "signed out with a profile" is briefly true of a real account
   * too, between two setStates.
   */
  const [preview] = useState(accountPreview);
  const [profile, setProfile] = useState<ProfileDto | null>(preview?.profile ?? null);
  const [wallet, setWallet] = useState<WalletState>(
    preview ? { kind: "ready", wallet: preview.wallet } : { kind: "loading" },
  );
  const [session, setSession] = useState<string | null>(preview?.session ?? null);
  const [signedIn, setSignedIn] = useState<boolean | null>(preview ? false : null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, originOnServer);

  useEffect(() => {
    if (preview) {
      return;
    }
    let live = true;
    void (async () => {
      const supabase = getSupabase();
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      if (!live) {
        return;
      }
      if (!data.session) {
        setSignedIn(false);
        setWallet({ kind: "none" });
        return;
      }
      setSignedIn(true);
      setSession(describeDevice(userAgent()));
      const token = data.session.access_token;
      const [found, dto] = await Promise.all([
        getProfile(token).then(
          (value) => value,
          () => null,
        ),
        readWallet(token).then(
          (value): WalletState => ({ kind: "ready", wallet: value }),
          // A 404 is an account with no wallet yet, which is a state and not a fault. Anything else
          // is a fault, and says so rather than drawing an empty wallet card that reads as broke.
          (error: unknown): WalletState =>
            error instanceof ApiError && error.status === 404
              ? { kind: "none" }
              : {
                  kind: "error",
                  reason: "Your balances could not be read just now. Nothing has moved.",
                },
        ),
      ]);
      if (!live) {
        return;
      }
      setProfile(found);
      setWallet(dto);
    })();
    return () => {
      live = false;
    };
  }, [preview]);

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
   * Opens the sheet and fetches the challenge behind it, so confirming reaches the operating system
   * without a network round trip in between — an awaited fetch there can spend the user activation
   * Safari requires for `credentials.create()`. Same ordering as features/auth and for the same
   * reason; lib/custody.ts is where both screens' ceremony actually lives.
   */
  function openSheet() {
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
      } catch (caught) {
        setSheet({ ...running, phase: "error", error: describeCustodyFailure(caught) });
      }
    })();
  }

  const handle = profile?.handle ?? null;
  const covered = coverage(PASSKEY_COUNT);

  return (
    <main className={styles.account} data-surface="dark">
      <h1 className={styles.srOnly}>Account</h1>

      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
          <span className={styles.wordmark}>PICKLER</span>
        </Link>
        <span className={styles.pill}>ACCOUNT</span>
        <span className={styles.spacer} />
        {MONAD_TESTNET.testnet && <span className={styles.pill}>TESTNET</span>}
        <span className={styles.handleChip}>
          <Mark className={styles.chipMark} />
          {handle ? `@${handle}` : "@—"}
        </span>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Account sections">
          <p className={styles.railLabel}>YOU</p>
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={styles.railItem}
              data-selected={item.key === section}
              aria-current={item.key === section}
              onClick={() => setSection(item.key)}
            >
              <span className={styles.square} data-tint={item.tint} aria-hidden="true" />
              <span className={styles.railText}>{item.label}</span>
              {/* The canvas puts "1 KEY" here below two passkeys. Nothing can count them, so the
                  badge carries the state the screen is actually in rather than the number it would
                  like to print. It still earns its caution pair: not knowing is not covered. */}
              {item.key === "security" && covered !== "covered" && (
                <span className={styles.railBadge}>{covered === "one" ? "1 KEY" : "UNKNOWN"}</span>
              )}
            </button>
          ))}
          <Link href="/console" className={styles.back}>
            ← Back to studio
          </Link>
        </nav>

        <div className={styles.main} key={section}>
          {preview && (
            <p className={styles.previewBanner}>
              PREVIEW · NOT AN ACCOUNT. Authentication is not configured here, so this screen is
              drawn from a fixture and the design checks have something to measure. The panels
              marked NOT BUILT look the same on a real account.
            </p>
          )}
          {signedIn === false && !preview ? (
            <p className={styles.signedOut}>
              Sign in to see this account.{" "}
              <Link href="/signin" className={styles.signInLink}>
                Sign in
              </Link>
            </p>
          ) : (
            <>
              {section === "wallet" && <WalletSection state={wallet} />}
              {section === "security" && (
                <SecuritySection
                  passkeys={PASSKEY_COUNT}
                  onAddPasskey={openSheet}
                  canAdd={signedIn === true}
                  session={session}
                />
              )}
              {section === "profile" && <ProfileSection profile={profile} origin={origin} />}
            </>
          )}
        </div>
      </div>

      {/* The sheet from features/auth rather than a second one built here. It runs the ceremony this
          screen needs — `backup`, the one that puts a key on a phone or a security key — its copy is
          covered phase by phase in apps/web/test/sheet.test.ts, and it already carries the
          `data-surface="dark"` a body-level dialog needs, because a dialog is a child of the body,
          inherits no surface, and would otherwise fall through to the light default. A second
          dialog would be a third chance to forget that; the repository has forgotten it twice. */}
      <PasskeySheet
        open={sheet !== null}
        ceremony="backup"
        phase={sheet?.phase ?? "idle"}
        error={sheet?.error ?? null}
        rpId={sheet?.options?.rp.id ?? null}
        userAgent={userAgent()}
        onConfirm={confirm}
        onCancel={() => setSheet(null)}
        onRetry={openSheet}
      />
    </main>
  );
}

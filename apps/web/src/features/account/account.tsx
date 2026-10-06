"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";
import { studioReturnHref } from "../studio/shell/account-return";
import { useStudioHref } from "@/features/site/studio-href";
import { useEffect, useState, useSyncExternalStore } from "react";
import { MONAD_TESTNET } from "@pickler/chain";
import { readSubOrganization, redirectFor } from "../auth/lib/custody";
import { passkeys as readPasskeys, wallet as readWallet } from "../auth/lib/custody-api";
import { describeDevice } from "../auth/lib/device";
import { ApiError, getProfile, type ProfileDto } from "../auth/lib/pickler-api";
import { getSupabase } from "../auth/lib/supabase-browser";
import { useAddPasskey } from "./components/add-passkey";
import { coverage } from "./lib/coverage";
import { accountPreview } from "./lib/preview";
import { SECTIONS, type SectionKey } from "./lib/sections";
import { ProfileSection } from "./sections/profile";
import { SecuritySection, type PasskeyState } from "./sections/security";
import { StudioSkeleton } from "../studio/skeleton";
import { StudioAccessRequest } from "../studio/access-request";
import { WalletSection, type WalletState } from "./sections/wallet";
import styles from "./account.module.css";

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

export function Account({
  opening,
  returnTo,
}: {
  opening: SectionKey;
  returnTo?: string | undefined;
}) {
  const studio = studioReturnHref(returnTo, useStudioHref());
  const { replace } = useRouter();
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
  const [passkeys, setPasskeys] = useState<PasskeyState>(
    preview ? { kind: "ready", passkeys: preview.passkeys } : { kind: "loading" },
  );
  const [signedIn, setSignedIn] = useState<boolean | null>(preview ? false : null);
  const addDevice = useAddPasskey();
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
      const [found, dto, keys] = await Promise.all([
        // A 404 is no profile, which the gate below sends to the handle step. Any other failure is
        // undefined: it decides nothing, and the profile section simply has nothing to show.
        getProfile(token).then(
          (value) => value,
          (error: unknown) =>
            error instanceof ApiError && error.status === 404 ? null : undefined,
        ),
        readSubOrganization(() => readWallet(token)).then(
          (read): WalletState => (read ? { kind: "ready", wallet: read } : { kind: "none" }),
          // Only a 404 is "no sub-organization". Anything else is a fault, and says so rather than
          // drawing an empty wallet card that reads as broke — or sending somebody who has a
          // wallet to create another.
          (): WalletState => ({
            kind: "error",
            reason: "Your balances could not be read just now. Nothing has moved.",
          }),
        ),
        // A rejection becomes `failed`, never an empty list. Everything from the repository method
        // down exists to keep those apart, and this is the last place it could be undone: `[]`
        // here would render "no passkeys on this account" for a database that did not answer.
        readPasskeys(token).then(
          (value): PasskeyState => ({ kind: "ready", passkeys: value }),
          (): PasskeyState => ({ kind: "failed" }),
        ),
      ]);
      if (!live) {
        return;
      }
      /* This is where the master wallet is shown, so it is the most visible place for the rule
         (spec §4.1): a signed-in person without a sub-organization creates it before anything
         else, on the signup's passkey step, and one with a wallet and no profile finishes signup
         at the handle step. Every section redirects, not only the wallet. */
      const away = redirectFor({ wallet: dto.kind === "none" ? null : dto, profile: found });
      if (away) {
        replace(away);
        return;
      }
      setProfile(found ?? null);
      setWallet(dto);
      setPasskeys(keys);
    })();
    return () => {
      live = false;
    };
  }, [preview, replace]);

  const handle = profile?.handle ?? null;
  const covered = coverage(passkeys.kind === "ready" ? passkeys.passkeys.length : null);

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
              {/* Nothing while the read is in flight: "unknown" is a real answer here — the list
                  could not be read — and flashing it for 200ms on every load would spend the
                  badge's alarm on something that is not alarming. */}
              {item.key === "security" && passkeys.kind !== "loading" && covered !== "covered" && (
                <span className={styles.railBadge}>{covered === "one" ? "1 KEY" : "UNREAD"}</span>
              )}
            </button>
          ))}
          <Link href={studio} className={styles.back}>
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
          {signedIn === null && !preview ? (
            <StudioSkeleton />
          ) : signedIn === false && !preview ? (
            <p className={styles.signedOut}>
              Sign in to see this account.{" "}
              <Link href="/signin" className={styles.signInLink}>
                Sign in
              </Link>
            </p>
          ) : (
            <>
              {section === "wallet" && <WalletSection state={wallet} />}
              {section === "access" && <StudioAccessRequest preview={Boolean(preview)} />}
              {section === "security" && (
                <SecuritySection
                  state={passkeys}
                  onAddPasskey={addDevice.open}
                  canAdd={signedIn === true}
                  session={session}
                />
              )}
              {section === "profile" && <ProfileSection profile={profile} origin={origin} />}
            </>
          )}
        </div>
      </div>

      {addDevice.sheet}
    </main>
  );
}

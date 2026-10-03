"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useAddPasskey } from "../../account/components/add-passkey";
import { PasskeyList, type PasskeyState } from "../../account/components/passkey-list";
import { joinedLabel } from "../../account/lib/profile";
import { ProfileSection } from "../../account/sections/profile";
import { passkeys as readPasskeys, type PasskeyDto } from "../../auth/lib/custody-api";
import { getProfile, type ProfileDto } from "../../auth/lib/pickler-api";
import { getSupabase } from "../../auth/lib/supabase-browser";
import { PREVIEW_NOTE } from "../shell/use-agent-studio";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { PASSKEY_NOTE, SHUT, passkeyTag, stagedProfile, tabAfter } from "./market-model";
import {
  ACCOUNT_TABS,
  RECORDS_PUBLIC_LINE,
  delegationRows,
  notifyRows,
  profileToggleRows,
  type AccountRow,
  type AccountTab,
} from "./model";
import styles from "./market.module.css";

export interface AccountProps extends LiveSectionProps {
  /** The tab it opens on (`?stage=perpl-account-profile|notify`); Security otherwise. */
  initialTab: AccountTab;
  /** A stage's passkeys, in place of `GET /v1/signing/passkeys`; null reads them. */
  stagedPasskeys: PasskeyDto[] | null;
}

const TAB_KEYS = ACCOUNT_TABS.map((tab) => tab.key);
const tabId = (key: AccountTab) => `live-account-tab-${key}`;
const panelId = (key: AccountTab) => `live-account-panel-${key}`;

/* The page's origin, for the profile section's link: the server renders "", the browser its own
   origin, with no second pass (as `/account` reads it). */
const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const originOnServer = () => "";

/** The signed-in account's token, read again each time (supabase-js refreshes it as it hands it). */
async function sessionToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}

/**
 * Account (canvas 692–747, spec L21) inside the studio: the account's handle and when it joined,
 * then three tabs (arrow keys, Home and End move between them).
 *
 * - Security: the passkeys from `GET /v1/signing/passkeys` drawn by the account page's own list
 *   (Remove shut, as there), "Add a device" (the account's add-passkey ceremony; the list is read
 *   again once a passkey is added), WHAT AGENTS MAY DO WITHOUT YOU with honest tags, and SESSIONS,
 *   Soon.
 * - Public profile: PUBLIC PROFILE, the account page's profile section embedded (the link it cannot
 *   open yet and the bio it cannot store; the handle and JOINED are this section's head, and the API
 *   keeps no display name to edit), the WHAT SHOWS switches shut with Soon, and the line that
 *   records are always public.
 * - Notifications: the five rows, shut with Soon (owner notices have no backend).
 *
 * The passkeys and the profile are read once, when this section opens, with the Supabase session;
 * until the session is known "Add a device" is shut with no reason to give. A staged studio reads
 * nothing: the stage's passkeys and an account named for its handle. A preview studio with no stage
 * has no list to show, so its passkeys read as unread rather than as none. There is no public page
 * for a person yet, so "View as public" is left out.
 */
export const Account: (props: AccountProps) => ReactElement = ({
  live,
  now,
  accountHandle,
  initialTab,
  stagedPasskeys,
}) => {
  const offline = live.preview;
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [passkeys, setPasskeys] = useState<PasskeyState>(() => {
    if (!offline) {
      return { kind: "loading" };
    }
    return stagedPasskeys ? { kind: "ready", passkeys: stagedPasskeys } : { kind: "failed" };
  });
  const [profile, setProfile] = useState<ProfileDto | null>(
    offline ? stagedProfile(accountHandle, now) : null,
  );
  /* Null until the session is read: a signed-in person is not told to sign in meanwhile. */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, originOnServer);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* A rejection is `failed`, never an empty list: "no passkeys" for a list nobody read is false. */
  const readKeys = useCallback(
    (token: string) =>
      readPasskeys(token).then(
        (value): PasskeyState => ({ kind: "ready", passkeys: value }),
        (): PasskeyState => ({ kind: "failed" }),
      ),
    [],
  );

  useEffect(() => {
    if (offline) {
      return;
    }
    void (async () => {
      /* A session that cannot be read is a list that was not read: `failed`, never "READING…". */
      let token: string | null;
      try {
        token = await sessionToken();
      } catch {
        if (mounted.current) {
          setSignedIn(false);
          setPasskeys({ kind: "failed" });
        }
        return;
      }
      if (!mounted.current) {
        return;
      }
      if (!token) {
        setSignedIn(false);
        setPasskeys({ kind: "failed" });
        return;
      }
      setSignedIn(true);
      const [keys, found] = await Promise.all([
        readKeys(token),
        /* A profile that cannot be read leaves the section with nothing to show, like /account. */
        getProfile(token).catch(() => null),
      ]);
      if (mounted.current) {
        setPasskeys(keys);
        setProfile(found);
      }
    })();
  }, [offline, readKeys]);

  const addDevice = useAddPasskey({
    onAdded: () => {
      void (async () => {
        try {
          const token = await sessionToken();
          if (token) {
            const keys = await readKeys(token);
            if (mounted.current) {
              setPasskeys(keys);
            }
          }
        } catch {
          if (mounted.current) {
            setPasskeys({ kind: "failed" });
          }
        }
      })();
    },
  });

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = tabAfter(TAB_KEYS, tab, event.key);
    if (next) {
      event.preventDefault();
      setTab(next);
      document.getElementById(tabId(next))?.focus();
    }
  }

  const joined = joinedLabel(profile?.created_at);
  const canAdd = !offline && signedIn === true;
  let addReason: string | undefined;
  if (offline) {
    addReason = PREVIEW_NOTE;
  } else if (signedIn === false) {
    addReason = "Sign in to add a passkey.";
  }

  return (
    <LiveSection section="account">
      <div className={styles.stack} id="live-account" data-tab={tab}>
        <div className={styles.accountHead}>
          <span className={styles.accountWho}>
            <span className={styles.accountHandle}>
              {accountHandle ? `@${accountHandle}` : "@—"}
            </span>
            {joined && <span className={styles.accountSince}>{joined}</span>}
          </span>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Account">
          {ACCOUNT_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={tabId(item.key)}
              className={styles.tab}
              aria-selected={item.key === tab}
              aria-controls={item.key === tab ? panelId(tab) : undefined}
              tabIndex={item.key === tab ? 0 : -1}
              onClick={() => setTab(item.key)}
              onKeyDown={onTabKey}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          className={styles.panel}
          role="tabpanel"
          id={panelId(tab)}
          aria-labelledby={tabId(tab)}
          tabIndex={0}
        >
          {tab === "security" && (
            <>
              <div className={styles.card} id="live-account-passkeys">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardLabel}>PASSKEY</h3>
                  <span className={styles.passkeyTag}>{passkeyTag(passkeys)}</span>
                </div>
                <p className={styles.cardNote}>{PASSKEY_NOTE}</p>
                <PasskeyList
                  state={passkeys}
                  secondPasskeyId="live-account-second-passkey"
                  compact
                />
                <button
                  type="button"
                  className={styles.addDevice}
                  aria-disabled={!canAdd || undefined}
                  title={addReason}
                  onClick={() => {
                    if (canAdd) {
                      addDevice.open();
                    }
                  }}
                >
                  Add a device
                </button>
              </div>

              <div className={styles.card} id="live-account-delegations">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardLabel}>WHAT AGENTS MAY DO WITHOUT YOU</h3>
                </div>
                <ul className={styles.rows}>
                  {delegationRows().map((row) => (
                    <li key={row.key} className={styles.row}>
                      <RowText row={row} />
                      <span className={styles.rowTag} data-tag={row.tag}>
                        {row.tag}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.card} id="live-account-sessions">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardLabel}>SESSIONS</h3>
                  <span className={styles.headSoon}>SOON</span>
                </div>
                <p className={styles.cardNote}>{SHUT.sessions}</p>
              </div>
            </>
          )}

          {tab === "profile" && (
            <>
              <div className={styles.card} id="live-account-profile">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardLabel}>PUBLIC PROFILE</h3>
                </div>
                <ProfileSection profile={profile} origin={origin} embedded />
              </div>
              <div className={styles.card} id="live-account-shows">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardLabel}>WHAT SHOWS ON YOUR PROFILE</h3>
                </div>
                <ShutRows rows={profileToggleRows()} reason={SHUT.toggle} />
                <p className={styles.panelLine}>{RECORDS_PUBLIC_LINE}</p>
              </div>
            </>
          )}

          {tab === "notify" && (
            <div className={styles.card} id="live-account-notify">
              <div className={styles.cardHead}>
                <h3 className={styles.cardLabel}>WHEN TO PING YOU</h3>
              </div>
              <ShutRows rows={notifyRows()} reason={SHUT.notify} />
            </div>
          )}
        </div>
      </div>
      {addDevice.sheet}
    </LiveSection>
  );
};

function RowText({ row }: { row: AccountRow }) {
  return (
    <span className={styles.rowText}>
      <span className={styles.rowName}>{row.name}</span>
      <span className={styles.rowNote}>{row.note}</span>
    </span>
  );
}

/** Rows with the canvas's switch, drawn off and shut: reachable, with the reason, and Soon. */
function ShutRows({ rows, reason }: { rows: AccountRow[]; reason: string }) {
  return (
    <ul className={styles.rows}>
      {rows.map((row) => (
        <li key={row.key} className={styles.row}>
          <RowText row={row} />
          <span className={styles.rowTag} data-tag={row.tag}>
            {row.tag}
          </span>
          <button
            type="button"
            role="switch"
            className={styles.switch}
            aria-checked="false"
            aria-disabled="true"
            aria-label={`${row.name}, soon`}
            title={reason}
          >
            <span className={styles.track}>
              <span className={styles.knob} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

"use client";
import Image from "next/image";
import Link from "next/link";
import { Button, ButtonLink, Icon } from "@pickler/ui";
import { SecondPasskey } from "@/features/auth/components/second-passkey";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import { HomeMenu } from "./menu";
import shell from "../studio.module.css";
import styles from "./home.module.css";

/**
 * The home before the first agent: the same top bar — Menu, profile — and the second-passkey
 * suggestion, with an empty state where the board would be. Nobody is sent to `/studio/new` on
 * arrival; "Create your first agent" and the Menu's "+ New agent" both go there when they choose.
 * Every section needs an agent, so the Menu lists them disabled rather than opening an empty one.
 */
export function EmptyHome({
  passkeys,
  canManage,
  preview,
  locked,
  error,
}: {
  passkeys: PasskeysKnown;
  canManage: boolean;
  /** A staged or fixture studio, which says so. Creating opens the creation flow's own preview. */
  preview: boolean;
  /** Why creating is closed on this workspace (research not enabled), or null when it is open. */
  locked: { title: string; note: string } | null;
  error: string;
}) {
  const canCreate = canManage && !locked;
  let lockNote = "";
  if (locked) {
    lockNote = `${locked.title} ${locked.note}`;
  } else if (!canManage) {
    lockNote = "You can view this workspace but not create agents.";
  }

  return (
    <main className={styles.home} data-surface="dark">
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
          <span>PICKLER</span>
          <small>TESTNET</small>
        </Link>
        <span className={styles.agentChip}>
          <b>No agent yet</b>
        </span>
        <span className={styles.spacer} />
        <HomeMenu
          agent={null}
          agents={[]}
          calls={0}
          running={false}
          canManage={canManage && !locked}
          onSection={noSection}
          onSwitch={noSection}
        />
        <Link href="/account" className={styles.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>

      {preview && (
        <p className={styles.previewNote} role="status">
          <Icon name="alert" size={13} />
          Design preview. This home is drawn from a fixture; nothing on it can be sent or saved.
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert" data-wide="true">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      <div className={styles.notice}>
        <SecondPasskey passkeys={passkeys} id="home-second-passkey" />
      </div>

      <section className={styles.first} id="home-empty" aria-labelledby="home-empty-title">
        <div className={styles.firstBody}>
          <span className={styles.eyebrow}>YOUR FIRST AGENT</span>
          <h1 className={styles.firstTitle} id="home-empty-title">
            Nothing running yet<span>.</span>
          </h1>
          <p className={styles.firstLine}>
            An agent reads the markets you point it at, researches one and makes its call on paper.
            Every step and every source stays on the record.
          </p>
          {lockNote && <p className={styles.newAgentNote}>{lockNote}</p>}
          <div className={styles.firstActions}>
            {canCreate ? (
              <ButtonLink as={Link} href="/studio/new" variant="primary" arrow>
                Create your first agent
              </ButtonLink>
            ) : (
              <Button variant="primary" disabled>
                Create your first agent
              </Button>
            )}
            <ButtonLink as={Link} href="/agents" variant="ghost">
              See what others built
            </ButtonLink>
          </div>
          <p className={styles.fine}>
            Or look around first: the Menu lists everything an agent gets.
          </p>
        </div>
      </section>
    </main>
  );
}

/* Every section and every switch needs an agent; the Menu disables them, so nothing calls these. */
function noSection(): void {}

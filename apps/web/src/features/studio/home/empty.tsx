"use client";
import Image from "next/image";
import Link from "next/link";
import { Button, ButtonLink, Icon, type IconName } from "@pickler/ui";
import { SecondPasskey } from "@/features/auth/components/second-passkey";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import { menuAccess } from "./access";
import { HomeMenu } from "./menu";
import shell from "../studio.module.css";
import styles from "./home.module.css";

/* The rail the "Pickler Studio Empty v4" canvas draws, every row disabled until an agent exists. */
const RAIL: { title: string; items: [IconName, string][] }[] = [
  {
    title: "RUN",
    items: [
      ["grid", "Overview"],
      ["chat", "Console"],
      ["target", "Trades"],
      ["activity", "Activity"],
    ],
  },
  {
    title: "BUILD",
    items: [
      ["file", "Brief"],
      ["sliders", "Sources & rules"],
      ["wallet", "Limits & funding"],
      ["user", "Identity & voice"],
    ],
  },
  { title: "GROW", items: [["globe", "Public profile"]] },
];

/* The canvas's five brief sections, drawn as its blank brief: what each one asks for. */
const BRIEF: [string, string, string][] = [
  [
    "THESIS",
    "why this edge exists, in plain words",
    "What does this agent believe that the market does not price yet?",
  ],
  ["IT READS", "one source per line", "A feed, an @account, a site it trusts…"],
  [
    "ENTERS WHEN",
    "every line must be true",
    "Conditions, one per line. The run shows which ones fired.",
  ],
  ["EXITS WHEN", "the first line that turns true closes it", "Take profit, stop, time limit…"],
  ["NEVER", "hard lines it will not cross", "The things a tired human would do at 3am."],
];

/**
 * The home before the first agent, as the "Pickler Studio Empty v4" canvas draws it: the top bar
 * with "No agent yet", the studio rail with every section disabled, and the first agent's brief
 * where the board would be — its five sections, the starting point beside it and an idle paper run.
 *
 * The canvas edits the brief here and runs it on paper in the browser. Neither has a backend: the
 * brief's sections are not the draft `/studio/new` builds, and a scripted run would be a run that
 * never happened. So the sections are drawn blank, as prompts, and "Create your first agent" goes to
 * `/studio/new`, where the draft, the passkey ceremony and the real first run are. Every section
 * needs an agent, so the rail (and, at phone width, the Menu) lists them disabled.
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
  /** A staged or fixture studio, which says so. Creating still links to /studio/new, which
      renders its own labelled preview when it has no session or no Supabase behind it. */
  preview: boolean;
  /** Why creating is closed on this workspace (research not enabled), or null when it is open. */
  locked: { title: string; note: string } | null;
  error: string;
}) {
  const researchLock = locked ? `${locked.title} ${locked.note}` : "";
  /* No agents, so no unfunded-agent lock: the same answer the Menu's "+ New agent" reads. */
  const access = menuAccess({ hasAgent: false, canManage, researchLock, fundLock: "" });

  return (
    <main className={styles.home} data-surface="dark">
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        <span className={styles.noAgent}>
          <span className={styles.noAgentMark} aria-hidden="true">
            +
          </span>
          <b>No agent yet</b>
        </span>
        <span className={styles.spacer} />
        <span className={styles.pill} data-tint="grey">
          TESTNET
        </span>
        <span className={styles.emptyMenu}>
          <HomeMenu
            agent={null}
            agents={[]}
            calls={0}
            running={false}
            canManage={canManage}
            researchLock={researchLock}
            onSection={noSection}
            onSwitch={noSection}
          />
        </span>
        <Link href="/account" className={styles.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>

      <div className={styles.emptyBody}>
        <nav className={styles.emptyRail} aria-label="Studio sections">
          {RAIL.map((group) => (
            <div key={group.title}>
              <p className={shell.railTitle}>{group.title}</p>
              <div className={shell.railItems}>
                {group.items.map(([icon, label]) => (
                  <span
                    key={label}
                    className={styles.emptyRailItem}
                    title={access.sectionNote}
                    aria-disabled="true"
                  >
                    <Icon name={icon} size={17} />
                    <span className={shell.railLabel}>{label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles.emptyMain}>
          <section className={styles.brief} id="home-empty" aria-labelledby="home-empty-title">
            {preview && (
              <p className={styles.emptyNote} role="status">
                <Icon name="alert" size={13} />
                Design preview. This home is drawn from a fixture; nothing on it can be sent or
                saved.
              </p>
            )}
            {error && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={13} />
                {error}
              </p>
            )}
            <SecondPasskey passkeys={passkeys} id="home-second-passkey" />

            <p className={styles.briefKicker}>YOUR FIRST AGENT · ITS BRIEF IS WHAT IT RUNS ON</p>
            <div className={styles.starts}>
              <span className={styles.startsLabel}>START FROM</span>
              <span className={styles.start} data-on="true">
                <i aria-hidden="true" />
                Blank
              </span>
              <Link href="/agents" className={styles.start}>
                <i data-tint="lime" aria-hidden="true" />A ranked agent
                <Icon name="arrow" size={12} />
              </Link>
            </div>

            <div>
              <h1 className={styles.briefName} id="home-empty-title">
                Name it
              </h1>
              <p className={styles.briefHandle}>
                <span>@handle</span>
                <small>BLANK BRIEF</small>
              </p>
            </div>

            {BRIEF.map(([label, sub, prompt]) => (
              <div key={label} className={styles.briefCard}>
                <div className={styles.briefCardHead}>
                  <span className={styles.briefLabel}>{label}</span>
                  <span className={styles.briefSub}>{sub}</span>
                  <span className={styles.briefTag}>EMPTY</span>
                </div>
                <p className={styles.briefPrompt}>{prompt}</p>
              </div>
            ))}

            {access.createNote && <p className={styles.newAgentNote}>{access.createNote}</p>}
            <div className={styles.briefActions}>
              {access.create ? (
                <ButtonLink as={Link} href="/studio/new" variant="primary" size="lg" arrow>
                  Create your first agent
                </ButtonLink>
              ) : (
                <Button variant="primary" size="lg" disabled>
                  Create your first agent
                </Button>
              )}
              <ButtonLink as={Link} href="/agents" variant="secondary" size="lg">
                See what others built
              </ButtonLink>
            </div>
            <p className={styles.briefFoot}>
              NOTHING GOES PUBLIC · IT RUNS ON PAPER UNTIL YOU FUND IT
            </p>
          </section>

          <aside className={styles.briefSide} aria-label="Starting point and paper run">
            <Image
              className={styles.briefMascot}
              src="/brand/mascot.webp"
              alt=""
              width={96}
              height={80}
            />
            <div className={styles.sideCard}>
              <span className={styles.sideTitle}>STARTING POINT</span>
              <div className={styles.source}>
                <span className={styles.sourceMark} aria-hidden="true">
                  —
                </span>
                <span className={styles.grow}>
                  <b className={styles.sourceName}>Blank</b>
                  <small className={styles.sourceLine}>No source</small>
                </span>
              </div>
              <p className={styles.sideText}>
                A blank brief. Every section is yours. Read a ranked agent first to see how a
                working one reads.
              </p>
              <Link href="/agents" className={styles.sideLink}>
                SEE THEIR RECEIPTS →
              </Link>
            </div>
            <div className={styles.sideCard}>
              <div className={styles.sideHead}>
                <span className={styles.sideTitle}>PAPER RUN</span>
                <span className={styles.sideState}>IDLE</span>
              </div>
              <p className={styles.runIdle}>ITS FIRST RUN IS ON PAPER, RIGHT AFTER YOU CREATE IT</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* Every section and every switch needs an agent; the Menu disables them, so nothing calls these. */
function noSection(): void {}

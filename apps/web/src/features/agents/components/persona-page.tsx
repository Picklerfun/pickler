"use client";

import type { AgentPersonaDto } from "@pickler/api-schema";
import Link from "next/link";
import { Button, ButtonLink, ChipLink, ChipText, Icon, Tag } from "@pickler/ui";
import { useState } from "react";
import { accentVars } from "@/lib/accent";
import styles from "../agents.module.css";
import { calibrationTone } from "../lib/reputation";
import { formatInteger, formatPercent, formatSigned } from "../lib/format";
import { useFollowing } from "@/features/wallet/lib/following";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import { ActivityRow } from "./activity-row";
import { AgentAvatar } from "./agent-parts";
import { ReadRow } from "./read-parts";

const TABS = ["activity", "answers", "record"] as const;
type Tab = (typeof TABS)[number];

const tabLabel: Record<Tab, string> = {
  activity: "Activity",
  answers: "Answers",
  record: "Record",
};

const xUrl = (handle: string) => `https://x.com/${handle.replace(/^@/, "")}`;

const venueLabel = (venue: AgentPersonaDto["venue"]) =>
  venue === "perps" ? "PERPL" : venue === "both" ? "PREDICTIONS + PERPL" : "PREDICTIONS";

/**
 * One agent up close. The head answers the two questions someone arrives with — is it any good, and
 * will it take my question — and the tabs hold what it has done, what it has answered in public,
 * and the record underneath both.
 */
export function PersonaPage({ persona, nowMs }: { persona: AgentPersonaDto; nowMs: number }) {
  const [tab, setTab] = useState<Tab>("activity");
  const wallet = useWallet();
  const follows = useFollowing(wallet.address);
  const following = follows.following(persona.handle);
  const tone = calibrationTone(persona.calibrationGap);
  const score = persona.score;
  const scoreTone = score >= 70 ? styles.toneWin : score >= 45 ? styles.toneCurve : styles.toneLoss;

  const counts: Record<Tab, string> = {
    activity: String(persona.decisions.length),
    answers: String(persona.reads.length),
    record: formatInteger(persona.resolved),
  };

  return (
    <main className={`${styles.main} ${styles.mainNarrow}`} style={accentVars(persona.accent)}>
      <Link href="/agents" className={styles.backLink}>
        <Icon name="arrowLeft" size={14} /> AGENTS
      </Link>

      <header className={styles.personaHead}>
        <AgentAvatar name={persona.name} accent={persona.accent} large />
        <div className={styles.heroBody}>
          <div className={styles.heroTitleRow}>
            <h1 className={styles.heroTitle}>{persona.name}</h1>
            <ChipText className={`${styles.chip} ${styles.beatChip}`}>
              {persona.beat.toUpperCase()}
            </ChipText>
            <span className={styles.quiet}>{venueLabel(persona.venue)}</span>
            {persona.xHandle && (
              <ChipLink
                href={xUrl(persona.xHandle)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.chip}
              >
                {persona.xHandle} <Icon name="external" size={13} />
              </ChipLink>
            )}
          </div>

          <p className={styles.personaDecides}>{persona.decides}</p>

          <dl className={styles.keyStats}>
            <KeyStat label="SCORE" value={String(score)} className={scoreTone} />
            <KeyStat
              label="HIT RATE"
              value={formatPercent(persona.hitRate)}
              className={styles.toneOpen}
            />
            <KeyStat label="PREDICTIONS" value={formatInteger(persona.resolved)} />
            <KeyStat
              label="P&L"
              value={`${formatSigned(persona.net)} MON`}
              className={persona.net < 0 ? styles.toneLoss : styles.toneWin}
            />
            <KeyStat label="FOLLOWERS" value={formatInteger(persona.followers)} />
          </dl>

          <div className={styles.personaActions}>
            {persona.service.open ? (
              <ButtonLink
                as={Link}
                href={`/agents/${persona.handle}/ask`}
                className={styles.askButton}
              >
                Ask · ${persona.service.price}
              </ButtonLink>
            ) : (
              <Tag className={styles.closedTag}>NOT TAKING QUESTIONS</Tag>
            )}
            <ButtonLink as={Link} href={`/tokens/${persona.slug}`} variant="secondary">
              Buy {persona.ticker}
            </ButtonLink>
            <Button
              variant="secondary"
              className={following ? styles.followingButton : undefined}
              aria-pressed={following}
              onClick={() =>
                wallet.status === "connected"
                  ? follows.toggle(persona.handle)
                  : void wallet.connect()
              }
              title={
                wallet.status === "connected"
                  ? undefined
                  : "Connect a wallet to keep a list of who you follow"
              }
            >
              {following ? "Following" : "Follow"}
            </Button>
          </div>

          {!persona.service.open && persona.service.closedNote && (
            <p className={styles.quiet}>{persona.service.closedNote}</p>
          )}
        </div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Agent sections">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            className={styles.tab}
            onClick={() => setTab(key)}
          >
            {tabLabel[key]}
            <span>{counts[key]}</span>
          </button>
        ))}
      </div>

      {tab === "activity" && (
        <section
          id="panel-activity"
          role="tabpanel"
          aria-labelledby="tab-activity"
          className={styles.panel}
        >
          {persona.decisions.length === 0 ? (
            <p className={styles.empty}>Nothing published yet.</p>
          ) : (
            <ul className={styles.feed}>
              {persona.decisions.map((event) => (
                <li key={event.id}>
                  <ActivityRow event={event} nowMs={nowMs} showAgent={false} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "answers" && (
        <section
          id="panel-answers"
          role="tabpanel"
          aria-labelledby="tab-answers"
          className={styles.answers}
        >
          {persona.reads.length === 0 ? (
            <p className={styles.emptyNote}>No public answers yet</p>
          ) : (
            persona.reads.map((read) => <ReadRow key={read.id} read={read} />)
          )}
          <p className={styles.quiet}>
            A read is answered on its own markets, with its sources and its limits attached. It
            cannot take orders or trade on anyone&rsquo;s behalf.
          </p>
        </section>
      )}

      {tab === "record" && (
        <section id="panel-record" role="tabpanel" aria-labelledby="tab-record">
          <dl className={`${styles.panel} ${styles.record}`}>
            <RecordItem label="PREDICTIONS" value={formatInteger(persona.resolved)} />
            <RecordItem
              label="HIT RATE"
              value={formatPercent(persona.hitRate)}
              className={styles.toneOpen}
            />
            <RecordItem
              label="P&L"
              value={`${formatSigned(persona.net)} MON`}
              className={persona.net < 0 ? styles.toneLoss : styles.toneWin}
            />
            <RecordItem
              label="SAID vs HAPPENED"
              value={`${persona.calibrationGap.toFixed(1)} pts`}
              className={styles[tone]}
            />
          </dl>
          <div className={`${styles.panel} ${styles.sideCard}`}>
            <h2 className={styles.label}>WHAT THE RECORD MEANS</h2>
            <p className={styles.blurb}>
              {persona.calibrationGap < 4
                ? "Its stated odds land within a couple of points of what happened, across every price bucket. That is the number that is hard to fake."
                : persona.calibrationGap < 10
                  ? "Its calls land a little less often than the prices it took them at — small, consistent drift rather than a broken read."
                  : "It takes positions at prices that imply more confidence than the results support. The hit rate looks survivable; the gap does not."}
            </p>
            <ButtonLink as={Link} href="/leaderboard#score" variant="secondary" size="sm">
              See on the leaderboard
            </ButtonLink>
          </div>
        </section>
      )}
    </main>
  );
}

function KeyStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string | undefined;
}) {
  return (
    <div className={styles.keyStat}>
      <dd className={className}>{value}</dd>
      <dt className={styles.label}>{label}</dt>
    </div>
  );
}

function RecordItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string | undefined;
}) {
  return (
    <div className={styles.recordItem}>
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  );
}

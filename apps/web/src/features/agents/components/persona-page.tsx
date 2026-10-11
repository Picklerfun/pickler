"use client";
import { PublicTokenTrade } from "@/features/tokens/public-token-trade";
import { AgentTokenCard } from "@/features/tokens/agent-token-card";

import type { AgentPersonaDto } from "@pickler/api-schema";
import Link from "next/link";
import { Button, ButtonLink, ChipLink, ChipText, Icon, Tag } from "@pickler/ui";
import { useState } from "react";
import { accentVars } from "@/lib/accent";
import styles from "../agents.module.css";
import { calibrationTone, scoreTone } from "../lib/reputation";
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

/** Until something has settled there is no gap to read, and the page says so rather than scoring it. */
function recordNote(gap: number | null): string {
  if (gap === null) {
    return "Nothing has settled yet, so there is no gap between its stated odds and what happened to measure.";
  }
  if (gap < 4) {
    return "Its stated odds land within a couple of points of what happened, across every price bucket. That is the number that is hard to fake.";
  }
  if (gap < 10) {
    return "Its calls land a little less often than the prices it took them at — small, consistent drift rather than a broken read.";
  }
  return "It takes positions at prices that imply more confidence than the results support. The hit rate looks survivable; the gap does not.";
}

/**
 * One agent up close. The head answers the two questions someone arrives with — is it any good, and
 * will it take my question — and the tabs hold what it has done, what it has answered in public,
 * and the record underneath both.
 */
export function PersonaPage({
  persona,
  nowMs,
  preview = false,
}: {
  persona: AgentPersonaDto;
  nowMs: number;
  preview?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const wallet = useWallet();
  const follows = useFollowing(wallet.address);
  const following = follows.following(persona.handle);
  const gap = persona.calibrationGap;
  const score = persona.score;
  const service = persona.service;
  const takingQuestions = service !== null && service.open;

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
            <KeyStat
              label="SCORE"
              value={score === null ? "—" : String(score)}
              className={score === null ? undefined : styles[scoreTone(score)]}
            />
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
          </dl>

          <div className={styles.personaActions}>
            {takingQuestions ? (
              <ButtonLink
                as={Link}
                href={`/agents/${persona.handle}/ask`}
                className={styles.askButton}
              >
                Ask · ${service.price}
              </ButtonLink>
            ) : (
              <Tag className={styles.closedTag}>NOT TAKING QUESTIONS</Tag>
            )}
            <Button
              variant="secondary"
              className={following ? styles.followingButton : undefined}
              disabled={preview}
              aria-pressed={following}
              onClick={() =>
                wallet.status === "connected"
                  ? follows.toggle(persona.handle)
                  : wallet.connect(`Ask ${persona.name} for a read`)
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

          {service !== null && !service.open && service.closedNote && (
            <p className={styles.quiet}>{service.closedNote}</p>
          )}
        </div>
      </header>

      <div className={styles.personaToken}>
        <AgentTokenCard
          token={persona.launchedToken ?? null}
          confirmationPending={persona.tokenConfirmation === "pending"}
          preview={preview}
        />
      </div>

      {persona.launchedToken && (
        <PublicTokenTrade
          key={persona.handle}
          handle={persona.handle}
          token={persona.launchedToken}
          preview={preview}
        />
      )}

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
              value={gap === null ? "not yet" : `${gap.toFixed(1)} pts`}
              className={gap === null ? undefined : styles[calibrationTone(gap)]}
            />
          </dl>
          <div className={`${styles.panel} ${styles.sideCard}`}>
            <p className={styles.label}>WHAT THE RECORD MEANS</p>
            <p className={styles.blurb}>{recordNote(gap)}</p>
            <Button
              variant="secondary"
              size="sm"
              disabled
              title="The public leaderboard is coming soon"
            >
              Leaderboard · Soon
            </Button>
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

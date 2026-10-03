"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@pickler/ui";
import { useMarketplaceHref } from "@/features/site/studio-href";
import { useNow } from "@/lib/now";
import type { Agent } from "../api";
import { HeaderDot } from "../shell/header";
import { railItemId } from "../shell/rail";
import { StatusChip } from "../shell/status-chip";
import { StudioShell, useShellModals } from "../shell/studio-shell";
import { Account } from "./account";
import { Agents } from "./agents";
import { Brief } from "./brief";
import { VIEW_ONLY_REASON } from "./build-model";
import { Console } from "./console";
import { Controls } from "./controls";
import { Decisions } from "./decisions";
import type { LiveStaged } from "./fixture";
import { Identity } from "./identity";
import { Leaders } from "./leaders";
import { Limits } from "./limits";
import type { LiveSectionProps } from "./live-section";
import { LiveStrip } from "./live-strip";
import { Markets } from "./markets";
import {
  HELP_LINKS,
  fixTarget,
  headerParts,
  liveCaps,
  liveRail,
  liveStatus,
  liveTiles,
  liveWalletRead,
  liveWarnings,
  publicProfilePath,
  warningLine,
  type LiveSectionKey,
} from "./model";
import { Overview } from "./overview";
import { Positions } from "./positions";
import { Posts } from "./posts";
import { Reason } from "./reason";
import { RecordSection } from "./record";
import { Sources } from "./sources";
import { useLive } from "./use-live";
import { usePauseToggle, type PauseToggle } from "./use-pause";
import { Wallets } from "./wallets";
import styles from "./live.module.css";

/**
 * A published Perpl agent's studio (studio-live-v1 L1), the "Pickler Studio v5 Live" canvas: the
 * live strip under the top bar (L6), the rail of RUN / BUILD / MARKETPLACE / YOU with the help links
 * and its public profile at the foot (L3), the header with Pause entries / Resume and "Stop · close
 * all" shut (L4), the four tiles (L5), the degraded banner (L14), and the section.
 *
 * The chrome is the shell's (`../shell/studio-shell.tsx`), shared with the draft studio and
 * configured here. The data and writes are `use-live.ts`'s; each section is its own file and takes
 * `LiveSectionProps`. With `staged` (`?stage=perpl-*`) the studio is the fixture's and touches no API.
 */
export function LiveStudio({
  agent,
  agents,
  canManage,
  newAgentLock,
  staged,
  preview,
  initialSection,
  accountHandle,
  onRefreshAgent,
  onSwitch,
  onNew,
}: {
  agent: Agent;
  agents: Agent[];
  canManage: boolean;
  /** Why "+ New agent" is shut (`home/gate.ts`'s `newAgentLock`), or "". */
  newAgentLock: string;
  /** The `?stage=perpl-*` fixture, or null. */
  staged: LiveStaged | null;
  /** A preview studio (no authentication here): nothing is read or written. */
  preview: boolean;
  /** The section it opens on: Overview after Go Public, or a `?section=` both studios know. */
  initialSection?: LiveSectionKey | undefined;
  /** The signed-in account's handle; null unread. */
  accountHandle: string | null;
  onRefreshAgent(): Promise<void>;
  onSwitch(agentId: string): void;
  /** "+ New agent": open the create screen. */
  onNew(): void;
}) {
  const [section, setSection] = useState<LiveSectionKey>(
    staged?.section ?? initialSection ?? "overview",
  );
  const wallClock = useNow();
  const now = staged ? staged.now : wallClock;
  const live = useLive({ agent, staged, preview, section, onRefreshAgent });
  const modals = useShellModals(live.readWallets);
  const pause = usePauseToggle(live.pause, agent.paused);
  const profile = useMarketplaceHref(publicProfilePath(agent.handle) ?? "/agents");
  /* "Fix it", "EVERY DECISION →" and every section's own links ("Connect X", "Caps & limits") move
     the section from outside the rail: the control pressed unmounts, so its rail item takes focus. */
  const focusRail = useRef(false);

  useEffect(() => {
    if (focusRail.current) {
      focusRail.current = false;
      document.getElementById(railItemId("live", section))?.focus();
    }
  }, [section]);

  const goFromOutside = (key: LiveSectionKey) => {
    focusRail.current = true;
    setSection(key);
  };

  const status = liveStatus(agent);
  const { caps } = liveCaps(agent);
  const read = liveWalletRead(agent.wallet, live.wallets);
  const warnings = liveWarnings(read, caps.perTradeAusd);
  const fix = fixTarget(warnings);

  const props: LiveSectionProps = {
    agent,
    live,
    canManage,
    pause,
    now,
    accountHandle,
    onSection: goFromOutside,
    onWallets: modals.openWallets,
    onCredits: modals.openCredits,
  };

  function body() {
    switch (section) {
      case "overview":
        return <Overview {...props} />;
      case "positions":
        return <Positions {...props} />;
      case "record":
        return <RecordSection {...props} />;
      case "decisions":
        return <Decisions {...props} />;
      case "console":
        return <Console {...props} />;
      case "posts":
        return <Posts {...props} />;
      case "brief":
        return <Brief {...props} stagedDraft={staged?.briefDraft ?? null} />;
      case "skills":
        return <Sources {...props} />;
      case "limits":
        return <Limits {...props} />;
      case "controls":
        return <Controls {...props} />;
      case "identity":
        return <Identity {...props} />;
      case "agents":
        return <Agents {...props} />;
      case "markets":
        return <Markets {...props} />;
      case "leaders":
        return <Leaders {...props} />;
      case "master":
        return <Wallets {...props} />;
      case "account":
        return (
          <Account
            {...props}
            initialTab={staged?.accountTab ?? "security"}
            stagedPasskeys={staged?.passkeys ?? null}
          />
        );
      default:
        return null;
    }
  }

  return (
    <StudioShell<LiveSectionKey>
      idPrefix="live"
      agent={agent}
      agents={agents}
      canManage={canManage}
      newAgentLock={newAgentLock}
      newAgentLabel="Create another agent"
      studio={live}
      modals={modals}
      status={
        <StatusChip id="live-status" tone={status.tone}>
          {status.label}
        </StatusChip>
      }
      /* Nothing is open and nothing waits on the owner until the Perpl runtime (`RailCounts`). */
      rail={liveRail(section, { positions: 0, decisions: 0 })}
      railFooter={
        <>
          <div className={styles.help}>
            {HELP_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={styles.helpLink}
                {...(link.href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <Icon name={link.icon} size={15} />
                {link.label}
              </a>
            ))}
          </div>
          {agent.handle && (
            <a
              href={profile}
              className={styles.profileLink}
              id="live-public-profile"
              target="_blank"
              rel="noopener noreferrer"
            >
              ITS PUBLIC PROFILE
              <Icon name="external" size={13} />
            </a>
          )}
        </>
      }
      onSection={setSection}
      headerSub={headerParts({
        handle: agent.handle,
        publishedAt: agent.publishedAt,
        now,
        section,
      }).map((part, index) => (
        <HeaderPart key={part} first={index === 0}>
          {part}
        </HeaderPart>
      ))}
      headerSide={
        <HeaderControls
          paused={agent.paused}
          action={status.action}
          canManage={canManage}
          pause={pause}
        />
      }
      tiles={liveTiles(read, caps.perDayAusd)}
      tilesLabel="Its money"
      banner={
        warnings.length > 0 && (
          <div className={styles.banner} id="live-banner" role="status">
            <Icon name="alert" size={14} />
            <span className={styles.bannerText}>{warningLine(warnings)}</span>
            {fix && (
              <button type="button" className={styles.bannerFix} onClick={() => goFromOutside(fix)}>
                Fix it
              </button>
            )}
          </div>
        )
      }
      onRefreshAgent={onRefreshAgent}
      onSwitch={onSwitch}
      onNew={onNew}
      onAccount={() => setSection("account")}
      strip={<LiveStrip onDecisions={() => goFromOutside("decisions")} />}
    >
      {body()}
    </StudioShell>
  );
}

/** One part of the header's line, with the dot before every part but the first. */
function HeaderPart({ first, children }: { first: boolean; children: string }) {
  return (
    <>
      {!first && <HeaderDot />}
      <span suppressHydrationWarning>{children}</span>
    </>
  );
}

/**
 * The header's controls (spec L4): "Pause entries" / "Resume", real, with its pending state (shared
 * with Controls' STOPS) and an inline failure that changes nothing; "Stop · close all" drawn shut
 * with Soon, because closing positions needs live trading. A view-only member's Pause stays
 * reachable, with the reason.
 */
function HeaderControls({
  paused,
  action,
  canManage,
  pause,
}: {
  paused: boolean;
  action: "Pause entries" | "Resume";
  canManage: boolean;
  pause: PauseToggle;
}) {
  const shut = !canManage || pause.pending;

  return (
    <div className={styles.controls}>
      <div className={styles.controlRow}>
        <button
          type="button"
          className={styles.pauseButton}
          id="live-pause"
          data-paused={paused}
          aria-disabled={shut || undefined}
          aria-busy={pause.pending || undefined}
          aria-describedby={canManage ? undefined : "live-pause-reason"}
          title={canManage ? undefined : VIEW_ONLY_REASON}
          onClick={() => {
            if (!shut) {
              void pause.toggle("header");
            }
          }}
        >
          <Icon name={paused ? "play" : "pause"} size={14} />
          {pause.pendingLabel ?? action}
        </button>
        <Reason id="live-pause-reason" text={canManage ? null : VIEW_ONLY_REASON} />
        <button
          type="button"
          className={styles.stopButton}
          aria-disabled="true"
          title="Closing positions comes with live trading."
        >
          <Icon name="x" size={14} />
          Stop · close all
          <span className={styles.soon}>SOON</span>
        </button>
      </div>
      {pause.error?.from === "header" && (
        <p className={styles.controlError} role="alert">
          {pause.error.text}
        </p>
      )}
    </div>
  );
}

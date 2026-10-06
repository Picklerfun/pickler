"use client";
import { useEffect, useRef, useState } from "react";
import { useNow } from "@/lib/now";
import type { Agent } from "../api";
import { HeaderDot } from "../shell/header";
import { Identity } from "../shell/identity";
import { Master } from "../shell/master";
import { railItemId } from "../shell/rail";
import { StatusChip } from "../shell/status-chip";
import { StudioShell, useShellModals } from "../shell/studio-shell";
import { TradeSoon } from "../shell/trade-soon";
import { Brief } from "./brief";
import { Console } from "./console";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import type { DraftStaged } from "./fixture";
import { Limits } from "./limits";
import { Locked } from "./locked";
import {
  draftRail,
  headerTiles,
  isLockedSection,
  sectionLabel,
  type DraftSectionKey,
} from "./model";
import { Overview } from "./overview";
import { allocationRows } from "./run-model";
import { Sources } from "./sources";
import { Trades } from "./trades";
import { useDraft } from "./use-draft";

/**
 * The header line's first part (canvas `headerSub`): the agent's handle, or on the YOU sections the
 * account's ("YOU · @nightowl"), just "YOU" until the account is read.
 */
const headerWho = (you: boolean, handle: string | undefined, account: string | null): string => {
  if (you) {
    return account ? `YOU · @${account}` : "YOU";
  }
  return handle ? `@${handle}` : "NO HANDLE";
};

/**
 * A private agent's studio (studio-draft-dashboard-v1 D1), the "Pickler Studio Draft" canvas's
 * created phase: the top bar (the agent and its switcher, DRAFT · PRIVATE, TESTNET, the master
 * wallet's AUSD | MON opening "Your wallets", AI credits, the account), the rail of RUN / BUILD /
 * GROW / YOU with the locked sections (D2), the header with the five tiles (D15), and the section.
 *
 * The chrome is the shell's (`../shell/studio-shell.tsx`), shared with the live studio and
 * configured here; Identity & voice, Trade and Master wallet are the shell's too, with the draft's
 * words. The data and writes are `use-draft.ts`'s; each section is its own file and takes
 * `DraftSectionProps`. With `staged` (`?stage=draft*`) the studio is the fixture's and touches no
 * API. Once Go Public lands the shell reloads the agent, which is no longer a draft, and the studio
 * opens the live one in its place, on its home (`onPublished`).
 */
export function DraftStudio({
  agent,
  agents,
  canManage,
  newAgentLock,
  staged,
  preview,
  initialSection,
  accountHandle,
  onRefreshAgent,
  onPublished,
  onSwitch,
  onNew,
}: {
  agent: Agent;
  agents: Agent[];
  canManage: boolean;
  /** Why "+ New agent" is shut (`home/gate.ts`'s `newAgentLock`), or "". */
  newAgentLock: string;
  /** The `?stage=draft*` fixture, or null. */
  staged: DraftStaged | null;
  /** A preview studio (no authentication here): nothing is read or written. */
  preview: boolean;
  initialSection?: DraftSectionKey | undefined;
  /** The signed-in account's handle, which the YOU sections' header line names; null unread. */
  accountHandle: string | null;
  onRefreshAgent(): Promise<void>;
  /** Go Public landed: the live studio that replaces this one opens on its home (D1). */
  onPublished(): void;
  onSwitch(agentId: string): void;
  /** "+ New agent": open the create screen. */
  onNew(): void;
}) {
  const [section, setSection] = useState<DraftSectionKey>(
    initialSection ?? staged?.section ?? "overview",
  );
  const wallClock = useNow();
  const now = staged ? staged.now : wallClock;
  const draft = useDraft({ agent, staged, preview, onRefreshAgent, onPublished });
  const modals = useShellModals(draft.readWallets);
  /* "Back to Overview" unmounts the button it was on, so focus moves to the rail's Overview. */
  const focusRail = useRef(false);

  const you = section === "trade" || section === "master";

  /* The rail's current item takes the focus when the locked panel's way back unmounted it (the
     rail itself keeps it in view). */
  useEffect(() => {
    if (focusRail.current) {
      focusRail.current = false;
      document.getElementById(railItemId("draft", section))?.focus();
    }
  }, [section]);

  const props: DraftSectionProps = {
    agent,
    draft,
    canManage,
    now,
    onSection: setSection,
    onWallets: modals.openWallets,
    onCredits: modals.openCredits,
  };

  function body() {
    if (isLockedSection(section)) {
      return (
        <Locked
          section={section}
          onBack={() => {
            focusRail.current = true;
            setSection("overview");
          }}
        />
      );
    }
    switch (section) {
      case "overview":
        return <Overview {...props} goPublic={staged?.goPublic ?? null} />;
      case "console":
        return <Console {...props} />;
      case "picks":
        return <Trades {...props} />;
      case "brief":
        return <Brief {...props} />;
      case "skills":
        return <Sources {...props} />;
      case "limits":
        return <Limits {...props} />;
      case "identity":
        return (
          <DraftSection section="identity">
            <Identity
              idPrefix="draft"
              agent={agent}
              studio={draft}
              canManage={canManage}
              avatarEditable
              handleNote="HANDLE IS FIXED"
              voiceSub="how every post reads"
              xSub="where it posts · optional"
              canDisconnectX
            />
          </DraftSection>
        );
      case "trade":
        return (
          <DraftSection section="trade">
            <TradeSoon
              idPrefix="draft"
              note="Trading from your master wallet opens with live Perpl trading."
            />
          </DraftSection>
        );
      case "master":
        return (
          <DraftSection section="master">
            <Master
              idPrefix="draft"
              agent={agent}
              studio={draft}
              canManage={canManage}
              now={now}
              accountHandle={accountHandle}
              allocation={allocationRows(draft.wallets)}
              fundLabel="Move to an agent"
              onFund={() => modals.openWallets(null)}
              onCredits={modals.openCredits}
            />
          </DraftSection>
        );
      default:
        return null;
    }
  }

  return (
    <StudioShell<DraftSectionKey>
      accountHandle={accountHandle}
      idPrefix="draft"
      agent={agent}
      agents={agents}
      canManage={canManage}
      newAgentLock={newAgentLock}
      studio={draft}
      modals={modals}
      status={<StatusChip id="draft-status">DRAFT · PRIVATE</StatusChip>}
      rail={draftRail(section)}
      onSection={setSection}
      headerSub={
        <>
          <span>{headerWho(you, agent.handle, accountHandle)}</span>
          <HeaderDot />
          <span>{sectionLabel(section)}</span>
        </>
      }
      tiles={headerTiles(draft.wallets, draft.positions)}
      tilesLabel="Your money"
      onRefreshAgent={onRefreshAgent}
      onSwitch={onSwitch}
      onNew={onNew}
    >
      {body()}
    </StudioShell>
  );
}

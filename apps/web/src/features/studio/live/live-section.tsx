"use client";
import type { ReactNode } from "react";
import type { Agent } from "../api";
import { StudioSection } from "../shell/section";
import { liveSectionLabel, type LiveSectionKey } from "./model";
import type { UseLive } from "./use-live";
import type { PauseToggle } from "./use-pause";

/**
 * What every live section is handed by the shell (`live-studio.tsx`): the agent, its data and
 * writes (`use-live.ts`), the clock and the account, and the ways out of the section. Brief and
 * Account add their staged state (`BriefProps`, `AccountProps`).
 */
export interface LiveSectionProps {
  agent: Agent;
  live: UseLive;
  /** The person may change this workspace; a view-only member sees every control shut. */
  canManage: boolean;
  /** "Pause entries" / "Resume": the header's state, shared with Controls' STOPS. */
  pause: PauseToggle;
  /** The clock times are read against: the fixture's on a stage, the wall clock otherwise. */
  now: number;
  /** The signed-in account's handle (Wallets' master card, Account's header); null unread. */
  accountHandle: string | null;
  /** Open another section of the rail; its rail item takes focus, since the control pressed goes. */
  onSection(key: LiveSectionKey): void;
  /** The check Decisions is opened on ("Why this trade"), or null for the whole feed. */
  focusCheck: string | null;
  /** "Why this trade": open Decisions on that check; null shows the whole feed again. */
  onWhy(checkId: string | null): void;
  /**
   * Open "Your wallets". `true` opens this agent's move form toward it ("Fund from master"),
   * `false` back to master ("Pull free AUSD back"), `null` the plain list.
   */
  onWallets(toAgent: boolean | null): void;
  /** Open the AI credits modal. */
  onCredits(): void;
}

/** A live section's frame (`../shell/section.tsx`): `#live-section-<key>`, named as the rail names it. */
export function LiveSection({
  section,
  title,
  children,
}: {
  section: LiveSectionKey;
  /** A visible heading in place of the hidden one. */
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <StudioSection
      idPrefix="live"
      section={section}
      label={liveSectionLabel(section)}
      title={title}
    >
      {children}
    </StudioSection>
  );
}

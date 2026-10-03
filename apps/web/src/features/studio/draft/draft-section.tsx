"use client";
import type { ReactNode } from "react";
import type { Agent } from "../api";
import { StudioSection } from "../shell/section";
import { sectionLabel, type DraftSectionKey } from "./model";
import type { UseDraft } from "./use-draft";

/**
 * What every draft section is handed by the shell (`draft-studio.tsx`): the agent, its data and
 * writes (`use-draft.ts`), and the ways out of the section. Overview adds Go Public's staged state.
 */
export interface DraftSectionProps {
  agent: Agent;
  draft: UseDraft;
  /** The person may change this workspace; a view-only member sees every control shut. */
  canManage: boolean;
  /** The clock times are read against: the fixture's on a stage, the wall clock otherwise. */
  now: number;
  /** Open another section of the rail. */
  onSection(key: DraftSectionKey): void;
  /**
   * Open "Your wallets". `true` opens this agent's move form toward it ("Fund from master"),
   * `false` back to master, `null` the plain list ("Move to an agent").
   */
  onWallets(toAgent: boolean | null): void;
  /** Open the AI credits modal. */
  onCredits(): void;
}

/** A draft section's frame (`../shell/section.tsx`): `#draft-section-<key>`, named as the rail names it. */
export function DraftSection({
  section,
  title,
  children,
}: {
  section: DraftSectionKey;
  /** A visible heading in place of the hidden one. */
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <StudioSection idPrefix="draft" section={section} label={sectionLabel(section)} title={title}>
      {children}
    </StudioSection>
  );
}

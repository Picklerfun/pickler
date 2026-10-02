"use client";
import type { ReactNode } from "react";
import type { Agent } from "../api";
import { sectionLabel, type DraftSectionKey } from "./model";
import type { UseDraft } from "./use-draft";
import styles from "./draft.module.css";

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

/**
 * A section's frame: `#draft-section-<key>`, the landmark the design harness proves, labelled by
 * its name. The header above already says which section this is in its line under the name, so
 * the heading is for assistive technology; a section that draws its own title can pass `title`.
 */
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
  const titleId = `draft-section-${section}-title`;
  return (
    <section className={styles.section} id={`draft-section-${section}`} aria-labelledby={titleId}>
      <h2 id={titleId} className={title ? styles.sectionTitle : styles.srOnly}>
        {title ?? sectionLabel(section)}
      </h2>
      {children}
    </section>
  );
}

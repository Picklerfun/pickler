"use client";
import { DraftSection, type DraftSectionProps } from "./section";

/**
 * Brief (canvas 676–710, spec §3.5): the four sections with their tags and RISK, saved in one
 * `draft.saveSetup`. Task 10 draws it.
 */
export function Brief(props: DraftSectionProps) {
  void props;
  return <DraftSection section="brief" />;
}

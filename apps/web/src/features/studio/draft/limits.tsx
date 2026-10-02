"use client";
import { DraftSection, type DraftSectionProps } from "./section";

/**
 * Limits & funding (canvas 479–526, spec §3.3, D11): its wallet with Refresh and arrivals, and
 * the hard caps saved through `draft.saveSetup`. Task 10 draws it.
 */
export function Limits(props: DraftSectionProps) {
  void props;
  return <DraftSection section="limits" />;
}

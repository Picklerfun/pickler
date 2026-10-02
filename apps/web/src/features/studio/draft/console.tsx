"use client";
import { DraftSection, type DraftSectionProps } from "./section";

/**
 * Console (canvas 530–636, spec §3.4, D12, D13): paper runs shut until the Perpl runtime, the
 * schedule's interval (`draft.saveInterval`) and next runs, Talk to it shut. Task 11 draws it.
 */
export function Console(props: DraftSectionProps) {
  void props;
  return <DraftSection section="console" />;
}

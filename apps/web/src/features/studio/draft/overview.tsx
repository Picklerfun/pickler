"use client";
import type { DraftGoPublicStage } from "./fixture";
import { DraftSection, type DraftSectionProps } from "./section";

export interface OverviewProps extends DraftSectionProps {
  /** Go Public's screen state on a `?stage=draft-x-*`, or null: the card starts closed. */
  goPublic: DraftGoPublicStage | null;
}

/**
 * Overview (canvas 339–441, spec §3.1): Go Public with Connect X (`go-public.tsx`,
 * `x-connect.tsx`), its wallet and schedule, its trades and activity. Task 8 draws it.
 */
export function Overview(props: OverviewProps) {
  void props;
  return <DraftSection section="overview" />;
}

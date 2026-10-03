"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Marketplace · Leaderboard (canvas 674–690, spec L19): the real one. Task 6 draws it.
 */
export const Leaders: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="leaders" />
);

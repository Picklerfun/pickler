"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Overview (canvas 172–223, spec L7): "Waiting on you" hidden with no proposals, and "Its
 * positions" flat until the Perpl runtime. Task 4 draws it.
 */
export const Overview: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="overview" />
);

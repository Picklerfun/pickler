"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Console (canvas 326–349, spec L7): the intro, the starters and the input shut, tagged Soon.
 * Task 4 draws it.
 */
export const Console: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="console" />
);

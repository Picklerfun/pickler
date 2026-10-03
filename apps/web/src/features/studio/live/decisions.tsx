"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Decisions (canvas 285–324, spec L7): the six filters at zero and the empty line. Task 4 draws
 * it.
 */
export const Decisions: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="decisions" />
);

"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Positions (canvas 225–262, spec L7, L8): flat, and WHAT IT WATCHES from the board. Task 4
 * draws it.
 */
export const Positions: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="positions" />
);

"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Sources & rules (canvas 393–454, spec L15): Perpl fixed, the web, IT MAY read-only. Task 5
 * draws it.
 */
export const Sources: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="skills" />
);

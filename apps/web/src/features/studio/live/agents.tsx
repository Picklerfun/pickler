"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Marketplace · Agents (canvas 609–643, spec L17): the real directory. Task 6 draws it.
 */
export const Agents: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="agents" />
);

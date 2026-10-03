"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Identity & voice (canvas 573–607, spec L16): the shared Identity with the public agent's
 * words. Task 5 draws it.
 */
export const Identity: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="identity" />
);

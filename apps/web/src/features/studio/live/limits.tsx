"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Limits (canvas 456–498, spec L12): its wallet and the five caps. Task 5 draws it.
 */
export const Limits: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="limits" />
);

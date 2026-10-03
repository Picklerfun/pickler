"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Marketplace · Markets (canvas 645–672, spec L18): the real board. Task 6 draws it.
 */
export const Markets: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="markets" />
);

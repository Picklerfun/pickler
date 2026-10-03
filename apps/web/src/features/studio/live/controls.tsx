"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Controls (canvas 500–571, spec L13): stops, how it runs, meters, health. Task 5 draws it.
 */
export const Controls: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="controls" />
);

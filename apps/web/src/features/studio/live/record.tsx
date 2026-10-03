"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Record (canvas 264–283, spec L7): empty until its first closed position. Task 4 draws it.
 */
export const RecordSection: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="record" />
);

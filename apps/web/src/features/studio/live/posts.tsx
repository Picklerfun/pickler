"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Posts (canvas 351–366, spec L7): the header and the empty line. Task 4 draws it.
 */
export const Posts: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="posts" />
);

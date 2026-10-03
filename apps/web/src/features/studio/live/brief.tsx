"use client";
import type { ReactElement } from "react";
import type { BriefText } from "../shell/build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";

export interface BriefProps extends LiveSectionProps {
  /** The textareas with edits not applied (`?stage=perpl-brief-dirty`), or null. */
  stagedDraft: BriefText | null;
}

/**
 * Brief (canvas 368–391, spec L9, L10): edited and applied as a new version, with VERSIONS. Task 5
 * draws it.
 */
export const Brief: (props: BriefProps) => ReactElement = () => <LiveSection section="brief" />;

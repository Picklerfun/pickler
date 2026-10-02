"use client";
import { DraftSection, type DraftSectionProps } from "./section";

/**
 * Identity & voice (canvas 443–477, spec §3.2): the avatar (the avatar picker), NAME, the fixed
 * handle, VOICE, and the X ACCOUNT card (`x-connect.tsx`). Task 9 draws it.
 */
export function Identity(props: DraftSectionProps) {
  void props;
  return <DraftSection section="identity" />;
}

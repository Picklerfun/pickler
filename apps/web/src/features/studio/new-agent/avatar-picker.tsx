"use client";
import type { NewAgentForm } from "./model";

/** "Its avatar". A placeholder until Task 10 draws it; the screen wires it already. */
export function AvatarPicker(props: {
  open: boolean;
  form: NewAgentForm;
  onChange(next: NewAgentForm): void;
  onClose(): void;
}): null {
  void props;
  return null;
}

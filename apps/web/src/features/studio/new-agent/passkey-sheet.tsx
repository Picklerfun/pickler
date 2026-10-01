"use client";

export type SheetPhase = "idle" | "busy" | "ok" | "err";

export interface PasskeySheetProps {
  open: boolean;
  title: string;
  body: string;
  done: string;
  phase: SheetPhase;
  twoStep: boolean;
  step: 1 | 2;
  onContinue(): void;
  onClose(): void;
}

/** The passkey sheet. A placeholder until Task 7 draws it; the screen wires it already. */
export function PasskeySheet(props: PasskeySheetProps): null {
  void props;
  return null;
}

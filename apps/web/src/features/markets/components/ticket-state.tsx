import styles from "../markets.module.css";
import type { Side } from "../lib/ticket";

/**
 * A ticket after it would have been sent. None of these are states the site can be in: no order
 * leaves the browser today, so they are drawings kept behind an explicit preview rather than
 * figures that could pass for a position.
 */
export type Preview = "noaccount" | "sent" | "open" | "nofill" | null;

export interface TicketState {
  phase: "ticket" | "review";
  preview: Preview;
  /** Raw input, so a half-typed "1." survives a keystroke. */
  margin: string;
  leverage: number;
}

export interface TicketActions {
  setMargin: (value: string) => void;
  setLeverage: (value: number) => void;
  /** Mirrors the level to the other side of the mark. */
  setSide: (side: Side) => void;
  stepLevel: (direction: 1 | -1) => void;
  stepHorizon: (direction: 1 | -1) => void;
  review: () => void;
  edit: () => void;
  clear: () => void;
  preview: (preview: Preview) => void;
}

export function PreviewTag() {
  return <p className={styles.previewTag}>DESIGN PREVIEW · NO ORDER EXISTS</p>;
}

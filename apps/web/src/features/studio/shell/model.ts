/**
 * The shapes the shell shared by the draft and the live studio draws (studio-live-v1 L2): the rail's
 * groups and the header's tiles. Each studio builds them in its own model (`draft/model.ts`,
 * `live/model.ts`); the shell only draws what it is handed. Types only, so the pure models that
 * import them stay free of React.
 */
import type { IconName } from "@pickler/ui";

/**
 * Which studio a shell part is drawn in: every id it renders starts with it (`#draft-studio`,
 * `#live-section-brief`), so a typo cannot silently move what the design harness proves.
 */
export type StudioIdPrefix = "draft" | "live";

export interface RailItem<K extends string = string> {
  key: K;
  icon: IconName;
  label: string;
  /** The current section. */
  on: boolean;
  /** Shut for now: still a button, which opens whatever says when it opens (the draft's D2). */
  locked?: boolean;
  /** A count beside the label, drawn only above zero (the live studio's L3). */
  badge?: number;
  /** The hover title, the label when left out; a locked item's is read out instead. */
  title?: string;
}

export interface RailGroup<K extends string = string> {
  title: string;
  items: RailItem<K>[];
}

export interface HeaderTile {
  label: string;
  value: string;
  /** Not built yet: drawn as "Soon", never as a number (draft spec D15). */
  soon: boolean;
}

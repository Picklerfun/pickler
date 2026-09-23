import type { AccentDto } from "@pickler/api-schema";

/**
 * The seven agent accents, in the order the canvases cycle them.
 *
 * Six of them are one hue on both surfaces. The seventh is not a seventh hue at all: it is violet
 * again, as the dark surface holds it (`#9B7BFF` against the light surface's `#5B3CE0`). There is
 * no light token carrying it, so a mark wearing this accent has to be on the dark surface to reach
 * the value — see `Mark`, which is the one place that knows.
 */
export const PALETTE = ["lime", "indigo", "amber", "orange", "magenta", "blue", "violet"] as const;

export type Hue = (typeof PALETTE)[number];

/**
 * The wire format's accent names against the palette's.
 *
 * `cyan` takes `indigo`: the canvases' palette has no cyan, and the deep violet is the slot no
 * accent name points at. `@/lib/accent` makes the same mapping for the same reason, and says there
 * that renaming the field in the schema is the real fix.
 */
const HUE: Record<AccentDto, Hue> = {
  lime: "lime",
  cyan: "indigo",
  amber: "amber",
  orange: "orange",
  magenta: "magenta",
  blue: "blue",
  violet: "violet",
};

export const hueOf = (accent: AccentDto): Hue => HUE[accent];

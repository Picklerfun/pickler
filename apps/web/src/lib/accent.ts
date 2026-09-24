import type { AccentDto } from "@pickler/api-schema";

/**
 * Each accent's fill, and the same fill as an `r,g,b` triple for the glows that need components
 * rather than a colour.
 *
 * `color` is written down twice on purpose — here and as `--pk-agent-<hue>-fill` in
 * packages/ui/src/styles.css — because `rgba()` cannot take a custom property as its first three
 * arguments. `accentVars` therefore paints from the token and only the triple comes from here, so
 * a value that drifts apart shows up as a glow that no longer matches its own fill.
 *
 * `cyan` is what drift looked like. It held #5AD8FF, which is in no token in the palette at all,
 * while its ground and its ink already took `indigo` below — so a cyan agent painted a cyan
 * tetromino with an indigo tint behind it, and the sign-up board was the screen that showed it.
 * It now holds indigo's, which is the colour the palette says this accent is.
 */
export const ACCENT_COLORS: Record<AccentDto, { color: string; rgb: string }> = {
  lime: { color: "#C8F03A", rgb: "200,240,58" },
  cyan: { color: "#5B3CE0", rgb: "91,60,224" },
  amber: { color: "#FFC93F", rgb: "255,201,63" },
  orange: { color: "#FF7A3D", rgb: "255,122,61" },
  magenta: { color: "#FF5FA2", rgb: "255,95,162" },
  violet: { color: "#9B7BFF", rgb: "155,123,255" },
  blue: { color: "#5B8CFF", rgb: "91,140,255" },
};

export const ACCENT_ORDER: AccentDto[] = [
  "lime",
  "cyan",
  "amber",
  "orange",
  "magenta",
  "blue",
  "violet",
];

/**
 * Which palette pair each accent takes.
 *
 * The palette is a separate layer from the semantic states: these say "this agent, not that one",
 * and an avatar is magenta because the agent is, not because anything was lost. Pointing them at the
 * states collapsed two accents onto one pair, which is the one thing an avatar must not do.
 *
 * `cyan` takes `indigo`. The palette the canvases show has no cyan — it is lime, a deep violet, an
 * amber, an orange, a magenta, a blue and a light violet — and the deep violet is the slot with no
 * accent name pointing at it. So the DTO's `cyan` renders indigo, which means the schema now has a
 * name that does not describe its colour; renaming it there is the real fix.
 */
const ACCENT_PALETTE: Record<AccentDto, string> = {
  lime: "lime",
  cyan: "indigo",
  amber: "amber",
  orange: "orange",
  magenta: "magenta",
  violet: "violet",
  blue: "blue",
};

export function accentVars(accent: AccentDto): React.CSSProperties {
  const { rgb } = ACCENT_COLORS[accent];
  const hue = ACCENT_PALETTE[accent];
  return {
    // The token, not the hex beside it: the fill a screen paints has to be a colour the palette
    // holds, or the design checks read it off the page as a literal someone typed — which is how
    // `cyan` was found. The triple below is the same colour, and only exists because `rgba()`
    // cannot be handed a custom property.
    "--accent": `var(--pk-agent-${hue}-fill)`,
    "--accent-rgb": rgb,
    "--accent-bg": `var(--pk-agent-${hue}-bg)`,
    "--accent-ink": `var(--pk-agent-${hue}-ink)`,
  } as React.CSSProperties;
}

/** Same custom properties for colors outside the accent palette. */
export function colorVars(color: string, rgb: string): React.CSSProperties {
  return { "--accent": color, "--accent-rgb": rgb } as React.CSSProperties;
}

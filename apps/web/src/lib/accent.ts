import type { AccentDto } from "@pickler/api-schema";

export const ACCENT_COLORS: Record<AccentDto, { color: string; rgb: string }> = {
  lime: { color: "#C8F03A", rgb: "200,240,58" },
  cyan: { color: "#5AD8FF", rgb: "90,216,255" },
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
  const { color, rgb } = ACCENT_COLORS[accent];
  const hue = ACCENT_PALETTE[accent];
  return {
    "--accent": color,
    "--accent-rgb": rgb,
    "--accent-bg": `var(--pk-agent-${hue}-bg)`,
    "--accent-ink": `var(--pk-agent-${hue}-ink)`,
  } as React.CSSProperties;
}

/** Same custom properties for colors outside the accent palette. */
export function colorVars(color: string, rgb: string): React.CSSProperties {
  return { "--accent": color, "--accent-rgb": rgb } as React.CSSProperties;
}

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
 * Which state pair each accent takes. The states *are* the accents, so a coloured tile with a letter
 * on it reads a pair from here rather than setting the accent on a wash of itself — a construction
 * with no light form, because over white a 14% wash is very nearly white and the letter is the
 * accent. `cyan` maps to `cool` alongside `blue`: the new palette has no cyan, and `--pk-cyan` is
 * carried forward as an alias of `--pk-blue`, so the two agent accents render alike.
 */
const ACCENT_STATE: Record<AccentDto, string> = {
  lime: "good",
  cyan: "cool",
  amber: "caution",
  orange: "warm",
  magenta: "loss",
  violet: "info",
  blue: "cool",
};

/**
 * CSS custom properties consumed by `.accent`-aware classes.
 *
 * `--accent` and `--accent-rgb` are the raw hue, for the glows and gradients on the dark pages that
 * still want one. `--accent-bg` and `--accent-ink` are the pair, and are what anything carrying text
 * should use: they are tokens, so they invert with the surface and the hue does not.
 */
export function accentVars(accent: AccentDto): React.CSSProperties {
  const { color, rgb } = ACCENT_COLORS[accent];
  const state = ACCENT_STATE[accent];
  return {
    "--accent": color,
    "--accent-rgb": rgb,
    "--accent-bg": `var(--pk-state-${state}-bg)`,
    "--accent-ink": `var(--pk-state-${state}-ink)`,
  } as React.CSSProperties;
}

/** Same custom properties for colors outside the accent palette. */
export function colorVars(color: string, rgb: string): React.CSSProperties {
  return { "--accent": color, "--accent-rgb": rgb } as React.CSSProperties;
}

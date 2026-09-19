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

/** CSS custom properties consumed by `.accent`-aware classes in landing.module.css. */
export function accentVars(accent: AccentDto): React.CSSProperties {
  const { color, rgb } = ACCENT_COLORS[accent];
  return { "--accent": color, "--accent-rgb": rgb } as React.CSSProperties;
}

/** Same custom properties for colors outside the accent palette. */
export function colorVars(color: string, rgb: string): React.CSSProperties {
  return { "--accent": color, "--accent-rgb": rgb } as React.CSSProperties;
}

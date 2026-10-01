import type { AccentDto } from "@pickler/api-schema";

/**
 * The one place a token is handed to CSS through an inline custom property.
 *
 * Which agent a screen shows is data, so its colour cannot be a class written ahead of time: the
 * element gets `--accent` (the fill), `--accent-bg` and `--accent-ink` (the tint and the ink
 * legible on it), each pointing at a palette token in packages/ui/src/styles.css. No colour value
 * lives here. The static design check (scripts/design/source.mjs) lets this module do that and no
 * other.
 */

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
  const hue = ACCENT_PALETTE[accent];
  return {
    "--accent": `var(--pk-agent-${hue}-fill)`,
    "--accent-bg": `var(--pk-agent-${hue}-bg)`,
    "--accent-ink": `var(--pk-agent-${hue}-ink)`,
  } as React.CSSProperties;
}

/**
 * A fill for something that is not an agent: the application form's pixels. The seven palette
 * hues, and the two inks for an answer that has no hue of its own.
 */
export type Swatch =
  "lime" | "indigo" | "amber" | "orange" | "magenta" | "violet" | "blue" | "ink" | "muted";

const SWATCH_FILL: Record<Swatch, string> = {
  lime: "--pk-agent-lime-fill",
  indigo: "--pk-agent-indigo-fill",
  amber: "--pk-agent-amber-fill",
  orange: "--pk-agent-orange-fill",
  magenta: "--pk-agent-magenta-fill",
  violet: "--pk-agent-violet-fill",
  blue: "--pk-agent-blue-fill",
  ink: "--pk-ink",
  muted: "--pk-ink-muted",
};

export function swatchVars(swatch: Swatch): React.CSSProperties {
  return { "--accent": `var(${SWATCH_FILL[swatch]})` } as React.CSSProperties;
}

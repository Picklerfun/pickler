/**
 * The few token values code has to hold as values, because it cannot read a stylesheet.
 *
 * Next's `viewport.themeColor` is written into the document head on the server, and a chart needs
 * something to draw with if it mounts before the stylesheet has applied. Everything else reads
 * `var(--pk-*)` and never comes here.
 *
 * Each value is written down twice on purpose: here and in `styles.css`.
 * `scripts/design/mirror.test.mjs` reads both and fails when they differ, so a colour changed in
 * the token file and forgotten here cannot ship. Keyed by the token's own name so that test needs
 * no table of its own.
 */
export const TOKEN_MIRROR = {
  light: {
    "--pk-bg": "#ffffff",
    "--pk-ink-faint": "#5a5f78",
    "--pk-rule-strong": "rgba(11, 13, 26, 0.12)",
    "--pk-win": "#2b732e",
    "--pk-loss": "#bb2a5d",
  },
} as const;

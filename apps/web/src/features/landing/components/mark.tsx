import styles from "../landing.module.css";
import type { Hue } from "../lib/palette";

/**
 * A coloured square: the unit this page is built from — the perk rows, the agent grid, the deposit
 * blocks, the four moves and the footer swatches are all this.
 *
 * Every hue reads a `--pk-agent-*` token, which holds the palette as hues rather than per surface,
 * because a mark is not text: it exists to be told from the six beside it, so it is the same colour
 * wherever it sits. `violet` used to reach its value by nesting `data-surface="dark"` — inverting a
 * whole surface to look up one colour, on a one-element subtree with nothing in it — because no
 * light token held `#9B7BFF`. Now one does.
 */
export function Mark({ hue, className }: { hue: Hue; className?: string | undefined }) {
  return (
    <span
      className={className ? `${styles.mark} ${className}` : styles.mark}
      data-hue={hue}
      aria-hidden="true"
    />
  );
}

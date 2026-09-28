import styles from "../landing.module.css";
import type { Hue } from "../lib/palette";

/**
 * A coloured square: the unit this page is built from — the perk rows, the agent grid, the deposit
 * blocks, the four moves and the footer swatches are all this.
 *
 * Every hue reads a `--pk-agent-*-fill`, the palette's member for anything filled rather than
 * written, held once rather than per surface because a swatch does not change identity when the page
 * around it changes. `violet` used to reach its value by nesting `data-surface="dark"` — a token
 * lookup wearing the inversion mechanism's clothes, on a childless span with nothing to invert —
 * because no light token held `#9B7BFF`. One does now.
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

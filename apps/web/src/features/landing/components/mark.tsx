import styles from "../landing.module.css";
import type { Hue } from "../lib/palette";

/**
 * A coloured square: the unit this page is built from — the perk rows, the agent grid, the deposit
 * blocks, the four moves and the footer swatches are all this.
 *
 * `violet` is the one accent whose value lives only on the dark surface, so that mark takes
 * `data-surface="dark"` and reads `--pk-violet` there. Hard-coding `#9B7BFF` would paint the same
 * pixels and be a literal no token holds; nesting the surface is the mechanism the system already
 * has for "the other surface's value, here".
 */
export function Mark({ hue, className }: { hue: Hue; className?: string | undefined }) {
  return (
    <span
      className={className ? `${styles.mark} ${className}` : styles.mark}
      data-hue={hue}
      data-surface={hue === "violet" ? "dark" : undefined}
      aria-hidden="true"
    />
  );
}

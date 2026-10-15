import styles from "../landing.module.css";
import type { Hue } from "../lib/palette";

/**
 * A coloured square: the unit this page is built from — the bubble dots, the way cards' corners,
 * the chat avatar and the footer swatches are all this.
 *
 * Every hue reads a `--pk-agent-*-fill`, the palette's member for anything filled rather than
 * written, held once rather than per surface because a swatch does not change identity when the page
 * around it changes. The `hue` rules are shared with anything else filled by hue (a tag, a call to
 * action), so one table maps a name to its token.
 */
export function Mark({ hue, className }: { hue: Hue; className?: string | undefined }) {
  return (
    <span
      className={
        className ? `${styles.mark} ${styles.hue} ${className}` : `${styles.mark} ${styles.hue}`
      }
      data-hue={hue}
      aria-hidden="true"
    />
  );
}

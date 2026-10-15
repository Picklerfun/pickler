import { swatchVars, type Swatch } from "@/lib/accent";
import styles from "../apply.module.css";

/**
 * A coloured square: the unit the page is built from — the card labels, the chips, the blocks in
 * YOUR PIECE, the arena's flows and the footer swatches. The hue arrives as a palette name and
 * `swatchVars` turns it into the token; no colour is written here or in the stylesheet.
 */
export function Mark({ swatch, className }: { swatch: Swatch; className?: string | undefined }) {
  return (
    <span
      className={className ? `${styles.mark} ${className}` : styles.mark}
      style={swatchVars(swatch)}
      aria-hidden="true"
    />
  );
}

import { sparkPoints } from "./run-model";
import styles from "./run.module.css";

/**
 * A market's last 24 h of marks as one line (WHAT IT WATCHES, spec L8), lime when the day is up and
 * pink when it is down (no direction, for a market the board does not list, draws nothing). The drawing is hidden from assistive technology: the row it sits in says
 * the same in words (`trailText`). Fewer than two marks draw an empty box of the same size.
 */
export function Sparkline({ trail, up }: { trail: readonly number[] | null; up: boolean | null }) {
  const points = trail ? sparkPoints(trail) : "";
  return (
    <svg
      className={styles.spark}
      data-up={up ?? undefined}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {points && (
        <polyline className={styles.sparkLine} points={points} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

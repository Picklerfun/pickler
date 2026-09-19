import type { AccentDto } from "@pickler/api-schema";
import { accentVars } from "@/lib/accent";
import styles from "../auth.module.css";
import { SHAPES, type ShapeKey } from "../lib/shapes";

export function Shape({
  shape,
  accent,
  className,
}: {
  shape: ShapeKey;
  accent: AccentDto;
  className?: string | undefined;
}) {
  return (
    <span className={className ?? styles.shape} style={accentVars(accent)} aria-hidden="true">
      {SHAPES[shape].map((row, r) => (
        <span key={r} className={styles.shapeRow}>
          {row.map((on, c) => (
            <span key={c} className={`${styles.cell} ${on ? styles.cellOn : ""}`} />
          ))}
        </span>
      ))}
    </span>
  );
}

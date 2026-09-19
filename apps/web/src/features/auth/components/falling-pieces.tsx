import type { AccentDto } from "@pickler/api-schema";
import styles from "../auth.module.css";
import { SHAPE_ACCENT, type ShapeKey } from "../lib/shapes";
import { Shape } from "./shape";

const PIECES: { left: string; dur: string; delay: string; spin: boolean; shape: ShapeKey }[] = [
  { left: "5%", dur: "13s", delay: "0s", spin: false, shape: "J" },
  { left: "17%", dur: "16s", delay: "3.5s", spin: true, shape: "S" },
  { left: "29%", dur: "11s", delay: "6.5s", spin: false, shape: "O" },
  { left: "43%", dur: "14.5s", delay: "1.5s", spin: true, shape: "T" },
  { left: "60%", dur: "12s", delay: "5s", spin: false, shape: "I" },
  { left: "74%", dur: "17s", delay: "2.5s", spin: true, shape: "L" },
  { left: "87%", dur: "13.5s", delay: "8s", spin: false, shape: "Z" },
];

export function FallingPieces() {
  return (
    <div aria-hidden="true">
      {PIECES.map((piece) => (
        <span
          key={piece.left}
          className={`${styles.fallingPiece} ${piece.spin ? styles.fallSpin : styles.fall}`}
          style={
            { left: piece.left, "--dur": piece.dur, "--delay": piece.delay } as React.CSSProperties
          }
        >
          <Shape
            shape={piece.shape}
            accent={SHAPE_ACCENT[piece.shape] as AccentDto}
            className={styles.shape}
          />
        </span>
      ))}
    </div>
  );
}

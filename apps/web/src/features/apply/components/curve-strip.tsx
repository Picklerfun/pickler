"use client";

import { useCallback, useState } from "react";
import { swatchVars } from "@/lib/accent";
import styles from "../apply.module.css";
import {
  CURVE_GOAL,
  CURVE_START,
  curvePct,
  curvePrice,
  curveStep,
  formatAusd,
  toGraduate,
} from "../lib/demo-model";
import { useDemoTick } from "../lib/use-demo-tick";

const TICK_MS = 1300;
const TICK_MARKS = ["25%", "50%", "75%"];

/**
 * The `$PICK` strip under the mascot: a token backing its way up the curve, graduating to a pool,
 * holding, then a new one starting over. Violet while it climbs, lime once it has graduated — the
 * hue is the strip's `--accent`, and everything inside reads it.
 *
 * Decorative: it explains what a token does, it is not one. Hidden from assistive technology, and
 * still under reduced motion.
 */
export function CurveStrip() {
  const [state, setState] = useState(CURVE_START);
  const tick = useCallback(() => setState((current) => curveStep(current, Math.random)), []);
  useDemoTick(TICK_MS, tick);

  const pct = curvePct(state.backed);
  return (
    <div
      className={styles.curve}
      data-surface="dark"
      data-graduated={state.graduated || undefined}
      style={swatchVars(state.graduated ? "lime" : "violet")}
      aria-hidden="true"
    >
      <span className={styles.coinWrap}>
        <span className={styles.coinRing} />
        <span className={styles.coin}>$PICK</span>
      </span>
      <span className={styles.curveBody}>
        <span className={styles.curveHead}>
          <span className={styles.gradBadge}>{state.graduated ? "GRADUATED" : "PRE-GRAD"}</span>
          <span className={styles.gradStage}>
            {state.graduated ? "TRADING IN THE POOL" : "BACKING ON THE CURVE"}
          </span>
          <span className={styles.tokenPrice}>
            {curvePrice(state.backed)} <span className={styles.unit}>AUSD</span>
          </span>
        </span>
        <span className={styles.track}>
          <span className={styles.trackBase} />
          <span className={styles.trackFill} style={{ width: `${pct}%` }} />
          {TICK_MARKS.map((left) => (
            <span key={left} className={styles.trackTick} style={{ left }} />
          ))}
          <span className={styles.knob} style={{ left: `${pct}%` }} />
          <span className={styles.gate} />
        </span>
        <span className={styles.curveFoot}>
          <span className={styles.curveDot} />
          <span className={styles.nowrap}>
            <span className={styles.curveBacked}>${formatAusd(state.backed)}</span> / $
            {formatAusd(CURVE_GOAL)}
          </span>
          <span className={styles.gradGoal}>
            {state.graduated ? "POOL OPEN" : `$${formatAusd(toGraduate(state.backed))} TO GRADUATE`}
          </span>
        </span>
      </span>
    </div>
  );
}

"use client";

import { useState } from "react";
import styles from "../landing.module.css";
import { advanceCurve, CURVE_SEED, CURVE_TICK_MS, curveView } from "../lib/demo";
import { useTicker } from "../lib/use-ticker";

/**
 * Backing, as a curve filling: `$PRNT` is bought up to $5,000, graduates to a pool, holds, and a
 * fresh curve starts. The arithmetic is `advanceCurve` and `curveView`; this owns the clock.
 */
export function Curve() {
  const [state, setState] = useState(CURVE_SEED);
  useTicker(CURVE_TICK_MS, () => setState((s) => advanceCurve(s, Math.random)));
  const view = curveView(state);
  const stage = state.graduated ? "graduated" : "pre";

  return (
    <article id="bento-curve" className={`${styles.bentoCard} ${styles.bentoCurve}`}>
      <p className={styles.cardTitle}>Back it. It graduates at $5,000.</p>
      <p className={styles.cardNote}>
        Tokens start on a curve and move to a pool at $5,000. Buying one never funds the agent’s
        trades.
      </p>
      <div className={styles.curveWell} data-surface="dark" data-stage={stage}>
        <div className={styles.curveHead}>
          <span className={styles.coin}>$PRNT</span>
          <span className={styles.coinBadge}>{view.badge}</span>
          <span className={styles.coinBacked}>{view.backed}</span>
        </div>
        <div className={styles.curveBars} aria-hidden="true">
          {view.bars.map((bar, i) => (
            <span
              key={i}
              className={styles.curveBar}
              data-lit={bar.lit || undefined}
              style={{ height: `${bar.height}%` }}
            />
          ))}
        </div>
        <div className={styles.curveFoot}>
          <span className={styles.liveDot} aria-hidden="true" />
          <span className={styles.curveGoal}>{view.goal}</span>
          <span className={styles.curveTarget}>GOAL $5,000</span>
        </div>
      </div>
    </article>
  );
}

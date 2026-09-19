"use client";

import type { LandingResponse, PickTrailStepDto } from "@pickler/api-schema";
import { useState } from "react";
import styles from "../landing.module.css";
import { accentVars } from "@/lib/accent";
import { formatAgo, formatClock } from "../lib/format";
import { useAnimationInterval, useIsClient, useLanding } from "../lib/landing-data";
import { AgentMark } from "./agent-mark";

const ROTATE_MS = 7000;

type Pick = LandingResponse["picks"][number];

const status: Record<Pick["outcome"], { label: string; className: string | undefined }> = {
  won: { label: "SETTLED", className: styles.toneWin },
  open: { label: "OPEN", className: styles.toneCaution },
  lost: { label: "LOST", className: styles.toneLoss },
};

const figureTone: Record<NonNullable<PickTrailStepDto["figure"]>["tone"], string | undefined> = {
  neutral: styles.toneNeutral,
  caution: styles.toneCaution,
  win: styles.toneWin,
  loss: styles.toneLoss,
};

function stepAccent(step: PickTrailStepDto, pick: Pick) {
  switch (step.tone) {
    case "signal":
      return accentVars("cyan");
    case "agent":
      return accentVars(pick.agent.accent);
    case "caution":
      return accentVars("amber");
    case "win":
      return accentVars("lime");
    case "loss":
      return accentVars("magenta");
  }
}

export function LatestPick() {
  const { data, nowMs } = useLanding();
  const isClient = useIsClient();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useAnimationInterval(() => {
    if (!paused && data.picks.length > 1) {
      setIndex((i) => (i + 1) % data.picks.length);
    }
  }, ROTATE_MS);

  const pick = data.picks[index % Math.max(1, data.picks.length)];
  if (!pick) {
    return null;
  }
  const { label, className } = status[pick.outcome];

  return (
    <div
      id="calls"
      className={styles.calls}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className={styles.callsHead}>
        <span className={styles.liveDot} aria-hidden="true" />
        <h2 className={styles.label}>LATEST PICK</h2>
        <span className={styles.callsAgo}>{formatAgo(pick.updatedAt, nowMs)}</span>
        {data.picks.length > 1 && (
          <span className={`${styles.dots} ${styles.callsDots}`}>
            {data.picks.map((p, i) => (
              <button
                key={`${p.agent.ticker}-${p.updatedAt}`}
                type="button"
                className={`${styles.dot} ${i === index % data.picks.length ? styles.dotActive : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`Show pick by ${p.agent.name}`}
                aria-pressed={i === index % data.picks.length}
              />
            ))}
          </span>
        )}
      </div>

      <article className={styles.glass} aria-live="polite">
        <header className={styles.pickHead}>
          <AgentMark agent={{ accent: pick.agent.accent, markSize: 3 }} tight />
          <h3 className={styles.pickAgent}>{pick.agent.name}</h3>
          <span className={styles.pickMeta}>
            {pick.agent.ticker} · {pick.agent.beat}
          </span>
          <span className={`${styles.pickStatus} ${className}`}>{label}</span>
        </header>
        <ol className={styles.trail}>
          {pick.steps.map((step, i) => (
            <li key={i} className={styles.trailStep} style={stepAccent(step, pick)}>
              <span className={styles.trailRail} aria-hidden="true">
                <span className={styles.pixel} />
                <span className={styles.trailLine} />
              </span>
              <span className={styles.trailBody}>
                <span className={styles.trailTitleRow}>
                  <span className={styles.trailTitle}>{step.title}</span>
                  {step.at === null ? (
                    <span className={styles.trailTime}>now</span>
                  ) : (
                    // Server renders UTC; the client switches to the viewer's time zone after hydration.
                    <time className={styles.trailTime} dateTime={step.at}>
                      {formatClock(step.at, isClient ? undefined : "UTC")}
                    </time>
                  )}
                </span>
                <span className={styles.trailNote}>{step.note}</span>
                {step.figure && (
                  <span className={`${styles.figure} ${figureTone[step.figure.tone]}`}>
                    {step.figure.text}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </article>
      <p className={styles.callsFoot}>Every agent leaves this trail. Losses stay up.</p>
    </div>
  );
}

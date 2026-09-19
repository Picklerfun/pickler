"use client";

import styles from "../landing.module.css";
import { accentVars } from "@/lib/accent";
import { formatInteger } from "../lib/format";
import { useLanding } from "../lib/landing-data";
import { AgentMark } from "./agent-mark";

export function LaunchingNow() {
  const { launches, graduationTarget } = useLanding().data;
  const target = formatInteger(graduationTarget);

  return (
    <section
      id="launching"
      className={`${styles.layer} ${styles.ruleBottom}`}
      aria-labelledby="launching-title"
    >
      <div className={`${styles.container} ${styles.launchHead}`}>
        <h2 id="launching-title" className={styles.launchTitle}>
          LAUNCHING NOW
        </h2>
        <span className={styles.launchSub}>TOKENS ON THE CURVE · GRADUATE AT {target} MON</span>
      </div>
      <ul className={`${styles.container} ${styles.launchGrid}`}>
        {launches.map((launch) => {
          const graduated = launch.stage === "graduated";
          const progress = graduated
            ? 1
            : Math.min(1, graduationTarget > 0 ? launch.raised / graduationTarget : 0);
          const stageStyle = graduated
            ? accentVars("lime")
            : { ...accentVars("cyan"), "--stage-ink": "#7FE3FF" };
          return (
            <li key={launch.agent.ticker} className={`${styles.glass} ${styles.launchCard}`}>
              <div className={styles.launchTop}>
                <AgentMark agent={launch.agent} />
                <span className={styles.launchTicker}>{launch.agent.ticker}</span>
                <span className={styles.stageBadge} style={stageStyle}>
                  {graduated ? "GRADUATED" : "PRE-GRAD"}
                </span>
              </div>
              <h3 className={styles.launchName}>{launch.agent.name}</h3>
              <p className={styles.launchSummary}>{launch.summary}</p>
              <p className={styles.launchMcap}>
                <span>MCAP</span>
                <strong>{formatInteger(launch.marketCap)} MON</strong>
              </p>
              <div
                className={styles.progress}
                style={stageStyle}
                role="progressbar"
                aria-label={`${launch.agent.ticker} progress to graduation`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
              </div>
              <p className={styles.launchRaised}>
                {graduated
                  ? `graduated · ${target} / ${target} MON`
                  : `${formatInteger(launch.raised)} / ${target} MON to graduate`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

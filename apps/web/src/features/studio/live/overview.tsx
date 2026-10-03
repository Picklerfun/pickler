"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { FlatPositions } from "./positions";
import { PositionCards, ProposalCards } from "./runtime-parts";
import { runtimeOn } from "./runtime-model";
import styles from "./run.module.css";

/**
 * Overview (canvas 172–223, spec L7). With the Perpl runtime off, "Waiting on you" is not drawn and
 * "Its positions" is flat. With it on (perpl-paper-runtime-v1 §3): "Waiting on you" with each
 * pending proposal (Enter / Skip, a live countdown), then "Its positions" as compact cards with the
 * stop–target meter and Close now.
 */
export const Overview: (props: LiveSectionProps) => ReactElement = ({
  agent,
  live,
  now,
  canManage,
  onWhy,
}) => (
  <LiveSection section="overview">
    <div className={styles.run}>
      {runtimeOn(live.record) ? (
        <>
          <ProposalCards live={live} now={now} canManage={canManage} />
          <PositionCards
            id="live-overview-positions"
            title="Its positions"
            live={live}
            now={now}
            canManage={canManage}
            full={false}
            paused={agent.paused}
            onWhy={onWhy}
          />
        </>
      ) : (
        <FlatPositions id="live-overview-positions" title="Its positions" />
      )}
    </div>
  </LiveSection>
);

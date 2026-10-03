"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { FlatPositions } from "./positions";
import { PositionCards, ProposalCards } from "./runtime-parts";
import { paperShown } from "./runtime-model";
import styles from "./run.module.css";

/**
 * Overview (canvas 172–223, spec L7). With the Perpl runtime off and no paper account, "Waiting on
 * you" is not drawn and "Its positions" is flat. With it on (perpl-paper-runtime-v1 §3): "Waiting
 * on you" with each pending proposal (Enter / Skip, a live countdown), then "Its positions" as
 * compact cards with the stop–target meter and Close now. With it off and a paper account, the
 * same, saying checks are paused (Enter shut; Skip and Close now still run, R3).
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
      {paperShown(live.record) ? (
        <>
          <ProposalCards
            live={live}
            now={now}
            canManage={canManage}
            running={live.record.runtimeEnabled}
          />
          <PositionCards
            id="live-overview-positions"
            title="Its positions"
            live={live}
            now={now}
            canManage={canManage}
            full={false}
            paused={agent.paused}
            running={live.record.runtimeEnabled}
            onWhy={onWhy}
          />
        </>
      ) : (
        <FlatPositions id="live-overview-positions" title="Its positions" />
      )}
    </div>
  </LiveSection>
);

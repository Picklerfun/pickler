"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { FlatPositions } from "./positions";
import styles from "./run.module.css";

/**
 * Overview (canvas 172–223, spec L7): "Waiting on you" is not drawn, because nothing proposes a
 * trade before the Perpl runtime, and "Its positions" is flat.
 */
export const Overview: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="overview">
    <div className={styles.run}>
      <FlatPositions id="live-overview-positions" title="Its positions" />
    </div>
  </LiveSection>
);

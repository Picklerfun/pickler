"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { RECORD_EMPTY, RECORD_META } from "./run-model";
import styles from "./run.module.css";

/**
 * Record (canvas 264–283, spec L7): the head with nothing closed and the empty line. The equity
 * chart and the figures come with the closed positions they draw (§7).
 */
export const RecordSection: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="record">
    <div className={styles.run}>
      <div className={styles.list} id="live-record-list">
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>Record</h3>
          <span className={styles.listMeta}>{RECORD_META}</span>
        </div>
        <div className={styles.empty}>{RECORD_EMPTY}</div>
      </div>
    </div>
  </LiveSection>
);

"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { postsHeader } from "./model";
import { POSTS_NOTE } from "./run-model";
import styles from "./run.module.css";

/**
 * Posts (canvas 351–366, spec L7): "Every call, in public" with where it posts (Pickler, and X when
 * an account is connected), and, without X, the banner whose "Connect X" opens Identity & voice.
 * Then the empty line: nothing has been posted before it trades.
 */
export const Posts: (props: LiveSectionProps) => ReactElement = ({ agent, onSection }) => {
  const header = postsHeader(agent.xHandle);

  return (
    <LiveSection section="posts">
      <div className={styles.run}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>{header.title}</h3>
          <span className={styles.xTag} data-x={header.connect === null}>
            {header.tag}
          </span>
        </div>
        <p className={styles.note}>{POSTS_NOTE}</p>

        {header.connect && (
          <div className={styles.xBanner} id="live-posts-x">
            <svg
              className={styles.xMark}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className={styles.xText}>{header.connect}</span>
            <button type="button" className={styles.connect} onClick={() => onSection("identity")}>
              Connect X
            </button>
          </div>
        )}

        <div className={styles.empty} id="live-posts-empty">
          {header.empty}
        </div>
      </div>
    </LiveSection>
  );
};

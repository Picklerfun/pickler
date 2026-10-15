"use client";
import type { ReactElement } from "react";
import { BrandMark } from "@pickler/ui";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { postsHeader } from "./model";
import { POSTS_NOTE } from "./run-model";
import styles from "./run.module.css";

/**
 * Public product posts remain distinct from the owner's private X timeline.
 * This surface never claims that read-only OAuth grants publishing permission.
 */
export const Posts: (props: LiveSectionProps) => ReactElement = ({ onSection }) => {
  const header = postsHeader();

  return (
    <LiveSection section="posts">
      <div className={styles.run}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>{header.title}</h3>
          <span className={styles.xTag} data-x={false}>
            {header.tag}
          </span>
        </div>
        <p className={styles.note}>{POSTS_NOTE}</p>

        {header.connect && (
          <div className={styles.xBanner} id="live-posts-x">
            <BrandMark name="x" size={14} />
            <span className={styles.xText}>{header.connect}</span>
            <button type="button" className={styles.connect} onClick={() => onSection("identity")}>
              X connection
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

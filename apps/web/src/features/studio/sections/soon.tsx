"use client";
import Link from "next/link";
import { Icon } from "@pickler/ui";
import { useMarketplaceHref } from "@/features/site/studio-href";
import type { Agent } from "../api";
import { PANELS, isSoon, type PanelKey } from "./rail";
import styles from "../studio.module.css";

/**
 * The one panel every section without a screen of its own draws: what it is, SOON when nothing is
 * behind it yet, and why. What the product does not support is shown as Soon, never faked and
 * never hidden. The board and the public profile keep their links out, because those pages exist.
 */
export function Soon({ section, agent }: { section: PanelKey; agent?: Agent | undefined }) {
  const directory = useMarketplaceHref("/agents");
  const page = PANELS[section];
  const handle = agent?.handle;
  return (
    <div className={styles.section} id={`studio-soon-${section}`} data-narrow="true">
      <p className={styles.eyebrow} data-tint="grey">
        {page.tag}
        {isSoon(section) && <span className={styles.stubState}>SOON</span>}
      </p>
      <div className={styles.sectionHead}>
        <h1>{page.title}</h1>
      </div>
      <p className={styles.stubBody}>{page.body}</p>
      {section === "board" && (
        <div className={styles.row}>
          <Link className={styles.action} href={directory}>
            <span className={styles.actionMark}>
              <Icon name="users" size={16} />
            </span>
            <span>
              <b>Every agent</b>
              <small>The directory, ranked</small>
            </span>
            <Icon name="arrow" size={15} />
          </Link>
          <div className={styles.action} aria-disabled="true">
            <span className={styles.actionMark}>
              <Icon name="bars" size={16} />
            </span>
            <span>
              <b>Leaderboard</b>
              <small>Coming soon</small>
            </span>
          </div>
        </div>
      )}
      {section === "profile" && handle && (
        <div className={styles.row}>
          <Link className={styles.action} href={`${directory}/${handle}`}>
            <span className={styles.actionMark}>
              <Icon name="globe" size={16} />
            </span>
            <span>
              <b>@{handle}</b>
              <small>Open the public page</small>
            </span>
            <Icon name="arrow" size={15} />
          </Link>
        </div>
      )}
    </div>
  );
}

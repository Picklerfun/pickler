"use client";
import { useEffect, type ReactNode } from "react";
import { Icon } from "@pickler/ui";
import type { RailGroup } from "./model";
import styles from "./shell.module.css";

export interface StudioRailProps<K extends string> {
  /** `draft` or `live`: each item is `#<idPrefix>-rail-<key>`. */
  idPrefix: string;
  /** The groups as the studio's model builds them (`draftRail`, `liveRail`). */
  groups: RailGroup<K>[];
  onSection(key: K): void;
  /** Under the groups, at the rail's foot: the live studio's "PUBLIC PAGE" link. */
  footer?: ReactNode;
}

/**
 * The studio's rail (studio-live-v1 L2, L3): groups of sections, the current one marked. A locked
 * item is still a button, drawn shut with a lock and its reason read out; a badge is a count beside
 * the label, drawn only above zero. Below 860px it is a row that scrolls inside itself.
 */
export function StudioRail<K extends string>({
  idPrefix,
  groups,
  onSection,
  footer,
}: StudioRailProps<K>) {
  const current = groups.flatMap((group) => group.items).find((item) => item.on)?.key;

  /* The current item stays in view on the phone's scrolling row (a deep link to Master wallet
     starts past the edge). */
  useEffect(() => {
    if (current !== undefined) {
      const item = document.getElementById(`${idPrefix}-rail-${current}`);
      item?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    }
  }, [idPrefix, current]);

  return (
    <nav className={styles.rail} aria-label="Agent sections">
      {groups.map((group) => (
        <div key={group.title} className={styles.railGroup}>
          <p className={styles.railTitle}>{group.title}</p>
          <div className={styles.railItems}>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={styles.railItem}
                id={`${idPrefix}-rail-${item.key}`}
                aria-current={item.on ? "page" : undefined}
                aria-disabled={item.locked || undefined}
                title={item.locked ? undefined : (item.title ?? item.label)}
                onClick={() => onSection(item.key)}
              >
                <Icon name={item.icon} size={17} />
                <span className={styles.railLabel}>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={styles.railBadge}>{item.badge}</span>
                )}
                {item.locked && (
                  <>
                    <span className={styles.railLock} aria-hidden="true">
                      <Icon name="lock" size={12} />
                    </span>
                    <span className={styles.srOnly}> · {item.title ?? item.label}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
      {footer && <div className={styles.railFoot}>{footer}</div>}
    </nav>
  );
}

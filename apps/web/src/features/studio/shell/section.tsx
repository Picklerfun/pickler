"use client";
import type { ReactNode } from "react";
import type { StudioIdPrefix } from "./model";
import styles from "./shell.module.css";

/**
 * A section's frame: `#<idPrefix>-section-<key>` (`draft-section-brief`, `live-section-brief`), the
 * landmark the design harness proves, labelled by its name. The header above already says which
 * section this is in its line under the name, so the heading is for assistive technology; a section
 * that draws its own title can pass `title`.
 */
export function StudioSection({
  idPrefix,
  section,
  label,
  title,
  children,
}: {
  /** `draft` or `live`. */
  idPrefix: StudioIdPrefix;
  /** The section's key in its studio's rail. */
  section: string;
  /** The section's name, as the rail says it: the hidden heading. */
  label: string;
  /** A visible heading in place of the hidden one. */
  title?: ReactNode;
  children?: ReactNode;
}) {
  const id = `${idPrefix}-section-${section}`;
  const titleId = `${id}-title`;
  return (
    <section className={styles.section} id={id} aria-labelledby={titleId}>
      <h2 id={titleId} className={title ? styles.sectionTitle : styles.srOnly}>
        {title ?? label}
      </h2>
      {children}
    </section>
  );
}

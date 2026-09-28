import type { ReactNode } from "react";
import styles from "../account.module.css";

/**
 * A part of this screen the product cannot yet answer for, drawn so that nobody mistakes it for a
 * part that is merely empty.
 *
 * That distinction is the whole reason this is a component rather than a sentence per site. An
 * empty list and an unbuilt feature look identical once they are both "no rows", and this is the
 * screen where somebody checks whether their money is safe — so every gap wears the same caution
 * badge in the same place and says what is missing by name. A person can tell a wired section from
 * an unwired one at a glance: the wired ones carry values, the unwired ones carry this.
 *
 * It never offers an action. A button here would be a confirm wired to nothing.
 */
export function NotYet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.notYet}>
      <span className={styles.notYetBadge}>NOT BUILT</span>
      <p className={styles.notYetTitle}>{title}</p>
      <p className={styles.notYetNote}>{children}</p>
    </div>
  );
}

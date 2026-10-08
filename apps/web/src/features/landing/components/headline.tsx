import Link from "next/link";
import { Icon } from "@pickler/ui";
import styles from "../landing.module.css";

/**
 * The headline and the two ways in. Three sentences, each closed by a full stop in the colour of
 * what it names: asking is violet, backing is amber, trading is lime, as they are everywhere else.
 */
export function Headline() {
  return (
    <>
      <h1 className={styles.headline}>
        <span className={styles.nowrap}>
          ASK IT
          <span className={styles.stop} data-hue="violet">
            .
          </span>
        </span>{" "}
        <span className={styles.nowrap}>
          BACK IT
          <span className={styles.stop} data-hue="amber">
            .
          </span>
        </span>
        <br />
        <span className={styles.nowrap}>
          TRADE IT
          <span className={styles.stop} data-hue="lime">
            .
          </span>
        </span>
      </h1>
      <p className={styles.lead}>Let the agents do the research. You take the trade.</p>
      <div className={styles.heroActions}>
        <a href="#app" className={`${styles.pill} ${styles.pillLime}`}>
          Get the app
          <span className={`${styles.pillBadge} ${styles.pillBadgeInk}`} aria-hidden="true">
            <Icon name="arrow" size={13} />
          </span>
        </a>
        {/* The dark pill on the white page: a subtree taking the opposite surface, so its ground,
            ink and hover come from the dark ramp rather than from values typed here. */}
        <Link href="/apply" className={`${styles.pill} ${styles.pillInk}`} data-surface="dark">
          Create an agent
          <span className={`${styles.pillBadge} ${styles.pillBadgeLime}`} aria-hidden="true">
            <Icon name="arrow" size={13} />
          </span>
        </Link>
      </div>
    </>
  );
}

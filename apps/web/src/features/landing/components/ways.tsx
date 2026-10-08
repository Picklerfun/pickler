import Link from "next/link";
import { Icon } from "@pickler/ui";
import styles from "../landing.module.css";
import { WAYS } from "../lib/demo";
import { Mark } from "./mark";

/**
 * INVEST IN WHAT COMES NEXT: the three things the marketplace is for, each on its own dark card
 * with the colour it carries everywhere else, and each a link to the page where it happens.
 */
export function Ways() {
  return (
    <section id="how" className={`${styles.shell} ${styles.section}`} aria-labelledby="how-title">
      <div className={styles.sectionHead}>
        <h2 id="how-title" className={styles.title}>
          INVEST IN WHAT
          <br />
          COMES NEXT
          <span className={styles.stop} data-hue="lime" aria-hidden="true" />
        </h2>
        <p className={styles.sectionLead}>
          Three ways to put money behind what comes next, from one wallet.
        </p>
      </div>
      <div className={styles.ways}>
        {WAYS.map((way) => (
          <article
            key={way.kicker}
            id={`how-${way.kicker.toLowerCase()}`}
            className={styles.way}
            data-surface="dark"
          >
            <div className={styles.wayHead}>
              <Mark hue={way.hue} className={styles.wayDot} />
              <span className={styles.wayKicker}>{way.kicker}</span>
              <span className={styles.wayVenue}>{way.venue}</span>
            </div>
            <p className={styles.wayTitle}>{way.title}</p>
            <p className={styles.wayNote}>{way.note}</p>
            <Link href={way.href} className={`${styles.wayCta} ${styles.hue}`} data-hue={way.hue}>
              {way.cta}
              <Icon name="arrow" size={13} />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

import styles from "../landing.module.css";
import { Ask } from "./ask";
import { Curve } from "./curve";
import { Keys } from "./keys";
import { Record } from "./record";

/** NOTHING HIDDEN: four panels, each one promise with a picture of it. */
export function Bento() {
  return (
    <section className={`${styles.shell} ${styles.section}`} aria-labelledby="hidden-title">
      <div className={styles.sectionHead}>
        <h2 id="hidden-title" className={styles.title}>
          NOTHING HIDDEN
          <span className={styles.stop} data-hue="lime">
            .
          </span>
        </h2>
        <p className={styles.sectionLead}>Your keys. Their record. Every number on chain.</p>
      </div>
      <div className={styles.bento}>
        <Record />
        <Ask />
        <Keys />
        <Curve />
      </div>
    </section>
  );
}

import styles from "../apply.module.css";

/** THE APPLICATION and, across from it, what the six answers add up to right now. */
export function SectionHead({ progress }: { progress: string }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id="application-title" className={styles.sectionTitle}>
        THE APPLICATION
      </h2>
      <p className={styles.progress} aria-live="polite">
        {progress}
      </p>
    </div>
  );
}

import styles from "../landing.module.css";

const platforms = ["MONAD", "ERC-8004", "UNISWAP V4", "PREDICTION MARKETS"];

export function RunsOn() {
  return (
    <section className={`${styles.layer} ${styles.ruleBottom}`} aria-label="Runs on">
      <ul className={`${styles.container} ${styles.runsOn}`}>
        <li className={`${styles.label} ${styles.runsOnLabel}`}>RUNS ON</li>
        {platforms.map((platform) => (
          <li key={platform} className={styles.runsOnItem}>
            {platform}
          </li>
        ))}
      </ul>
    </section>
  );
}

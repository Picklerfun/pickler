import styles from "../landing.module.css";

const PLATFORMS = ["MONAD", "ERC-8004", "UNISWAP V4"];

export function RunsOn() {
  return (
    <ul className={styles.runsOn} aria-label="Runs on">
      <li className={`${styles.label} ${styles.runsOnLabel}`}>RUNS ON</li>
      {PLATFORMS.map((platform) => (
        <li key={platform} className={styles.runsOnItem}>
          {platform}
        </li>
      ))}
    </ul>
  );
}

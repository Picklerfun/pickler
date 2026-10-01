import styles from "./unused-class.module.css";

const outcome = { won: "resultWon" } as const;

export function Reader({ won }: { won: keyof typeof outcome }) {
  return (
    <div className={`${styles.page} ${styles["panel"]} ${styles[outcome[won]]}`}>
      <a className={styles.link} href="#top">
        top
      </a>
    </div>
  );
}

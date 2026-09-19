import styles from "../landing.module.css";

export function SpaceBackground() {
  return (
    <div aria-hidden="true">
      <div className={styles.space} />
      <div className={styles.starsNear} />
      <div className={styles.starsFar} />
      <div className={styles.nebula} />
      <div className={styles.floorGrid} />
    </div>
  );
}

import { Skeleton } from "@pickler/ui";
import styles from "./skeleton.module.css";

/** Stable placeholder geometry for asynchronous Studio and Account reads. No visible load copy. */
export function StudioSkeleton({
  variant = "workspace",
}: {
  variant?: "workspace" | "wallet" | "access" | "rows";
}) {
  return (
    <div
      className={styles.placeholder}
      data-variant={variant}
      role="status"
      aria-label="Loading"
      aria-busy="true"
      data-skeleton="true"
    >
      {variant === "workspace" && (
        <div className={styles.identity}>
          <Skeleton shape="avatar" />
          <Skeleton shape="title" />
        </div>
      )}
      {variant !== "workspace" && <Skeleton shape="title" />}
      <Skeleton />
      <Skeleton className={styles.short} />
      {variant === "workspace" && <Skeleton shape="panel" />}
      {variant === "wallet" && (
        <div className={styles.tiles}>
          <Skeleton shape="panel" />
          <Skeleton shape="panel" />
        </div>
      )}
      {variant !== "rows" && <Skeleton shape="button" />}
    </div>
  );
}

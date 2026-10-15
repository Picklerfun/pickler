import type { HTMLAttributes } from "react";

/** Decorative placeholder. The consuming region supplies its loading label and aria-busy. */
export function Skeleton({
  shape = "line",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  shape?: "line" | "title" | "avatar" | "button" | "panel";
}) {
  return (
    <span {...props} className={`pk-skeleton ${className}`} data-shape={shape} aria-hidden="true" />
  );
}

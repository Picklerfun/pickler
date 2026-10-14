import type { ComponentPropsWithoutRef } from "react";

export type SelectProps = Omit<ComponentPropsWithoutRef<"select">, "size"> & {
  /** Visual control size; the native select remains a dropdown. */
  size?: "sm" | "md" | "lg" | undefined;
  shape?: "box" | "pill" | undefined;
};

/** Native selection with the surface's tokens and the browser's keyboard and option behavior. */
export function Select({ size = "md", shape = "box", className, ...props }: SelectProps) {
  return (
    <select
      className={["pk-select", className].filter(Boolean).join(" ")}
      data-size={size}
      data-shape={shape}
      {...props}
    />
  );
}

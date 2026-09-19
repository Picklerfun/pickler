import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/** A filter or toggle. Pressed state is announced with aria-pressed, not only with colour. */
export function Chip({
  selected = false,
  className,
  children,
  type = "button",
  ...props
}: {
  selected?: boolean | undefined;
  children?: ReactNode | undefined;
} & ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={["pk-chip", className].filter(Boolean).join(" ")}
      type={type}
      aria-pressed={selected}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A chip that takes you somewhere: a contract on an explorer, an agent's page, an X handle. It is
 * the same object as a Chip but it navigates, so it is never pressed and never a button. `as`
 * takes the router's link component; it defaults to a plain anchor.
 */
export function ChipLink<T extends ElementType = "a">({
  as,
  className,
  children,
  ...props
}: { as?: T; children?: ReactNode } & Omit<ComponentPropsWithoutRef<T>, "as" | "children">) {
  const Component = (as ?? "a") as ElementType;
  return (
    <Component className={["pk-chip", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </Component>
  );
}

/**
 * A chip that only reads: a market cap, a venue, a vibe. Same object as a Chip, without a press
 * and without a destination. A Tag is the louder cousin, for a status the eye should catch first.
 */
export function ChipText({ className, children, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span className={["pk-chip", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}

/** Read-only status: a stage, an outcome, a kind of event. Not clickable. */
export function Tag({ className, children, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span className={["pk-tag", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}

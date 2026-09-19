import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { Icon } from "./icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "tile";
export type ButtonSize = "sm" | "md" | "lg";

/* The repo compiles with exactOptionalPropertyTypes, and a CSS module class is `string |
   undefined`, so every optional prop here says so rather than making callers guard. */
interface ButtonOwnProps {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Uppercase mono label, for navigation and utility actions. */
  mono?: boolean | undefined;
  block?: boolean | undefined;
  /** Trailing arrow, for actions that move you somewhere. */
  arrow?: boolean | undefined;
  /** The lit marketing call to action: the hero, the waitlist, the application. One per page. */
  glow?: boolean | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
}

const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");

/**
 * The one button in the product. Shapes and sizes come from @pickler/ui/styles.css; tone follows
 * the surrounding `data-surface`. Only one `primary` per view, and never two filled buttons side
 * by side: pair a primary with a secondary.
 */
export function Button({
  variant = "primary",
  size = "md",
  mono = false,
  block = false,
  arrow = false,
  glow = false,
  type = "button",
  className,
  children,
  ...props
}: ButtonOwnProps & ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={classes("pk-button", className)}
      type={type}
      data-variant={variant}
      data-size={size}
      data-mono={mono || undefined}
      data-block={block || undefined}
      data-glow={glow || undefined}
      {...props}
    >
      {children}
      {arrow && <Icon name="arrow" size={16} />}
    </button>
  );
}

/**
 * The same button as a link. `as` takes the router's link component so navigation stays client
 * side; it defaults to a plain anchor.
 */
export function ButtonLink<T extends ElementType = "a">({
  as,
  variant = "secondary",
  size = "md",
  mono = false,
  block = false,
  arrow = false,
  glow = false,
  className,
  children,
  ...props
}: ButtonOwnProps & { as?: T } & Omit<ComponentPropsWithoutRef<T>, keyof ButtonOwnProps | "as">) {
  const Component = (as ?? "a") as ElementType;
  return (
    <Component
      className={classes("pk-button", className)}
      data-variant={variant}
      data-size={size}
      data-mono={mono || undefined}
      data-block={block || undefined}
      data-glow={glow || undefined}
      {...props}
    >
      {children}
      {arrow && <Icon name="arrow" size={16} />}
    </Component>
  );
}

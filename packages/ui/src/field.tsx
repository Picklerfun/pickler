import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Text entry, and the label and note around it.
 *
 * `Field` is the frame: a mono micro label above, the control, and one line underneath that can
 * carry a hint, a validation note or an error. `Input` and `Textarea` are the controls. Colour,
 * radius and the focus ring come from the surface, so a field on the public site and a field in
 * the console are the same object in two tones.
 */

export type FieldTone = "quiet" | "good" | "warn" | "bad";

export function Field({
  label,
  note,
  tone = "quiet",
  htmlFor,
  className,
  children,
}: {
  /** Mono micro label. Leave it out only when the control is labelled some other way. */
  label?: ReactNode;
  note?: ReactNode;
  tone?: FieldTone | undefined;
  htmlFor?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const Wrapper = htmlFor ? "div" : "label";
  return (
    <Wrapper className={className ? `pk-field ${className}` : "pk-field"}>
      {label && (
        <span className="pk-field-label" {...(htmlFor ? { id: `${htmlFor}-label` } : {})}>
          {label}
        </span>
      )}
      {children}
      {note && (
        <span className="pk-field-note" data-tone={tone} aria-live="polite">
          {note}
        </span>
      )}
    </Wrapper>
  );
}

type Shared = {
  /** `sm` for a filter row, `lg` for a form the page is built around. */
  size?: "sm" | "md" | "lg" | undefined;
  /** Tabular content — a ticker, a handle, an address — reads in mono. */
  mono?: boolean | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
};

/** A single line of text. `prefix` puts a fixed mark inside the frame, like the @ before a handle. */
export function Input({
  size = "md",
  mono = false,
  invalid = false,
  shape = "box",
  prefix,
  className,
  ...props
}: Shared & {
  shape?: "box" | "pill" | undefined;
  prefix?: ReactNode;
} & Omit<ComponentPropsWithoutRef<"input">, "size" | "prefix">) {
  const field = (
    <input
      className={prefix ? "pk-input-inner" : ["pk-input", className].filter(Boolean).join(" ")}
      data-size={size}
      data-mono={mono || undefined}
      data-shape={shape === "pill" ? "pill" : undefined}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
  if (!prefix) {
    return field;
  }
  return (
    <span
      className={["pk-input", "pk-input-group", className].filter(Boolean).join(" ")}
      data-size={size}
      data-shape={shape === "pill" ? "pill" : undefined}
      aria-invalid={invalid || undefined}
    >
      <span className="pk-input-prefix" aria-hidden="true">
        {prefix}
      </span>
      {field}
    </span>
  );
}

/** Several lines of text. It grows downward only, never sideways. */
export function Textarea({
  size = "md",
  mono = false,
  invalid = false,
  rows = 3,
  className,
  ...props
}: Shared & Omit<ComponentPropsWithoutRef<"textarea">, "size">) {
  return (
    <textarea
      className={["pk-input", "pk-textarea", className].filter(Boolean).join(" ")}
      data-size={size}
      data-mono={mono || undefined}
      aria-invalid={invalid || undefined}
      rows={rows}
      {...props}
    />
  );
}

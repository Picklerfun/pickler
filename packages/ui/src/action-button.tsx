"use client";

import { useId, type ComponentPropsWithoutRef } from "react";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";

export type ActionButtonState =
  "ready" | "working" | "waiting" | "wallet" | "success" | "error" | "unknown";

/** Visual feedback only. The consumer owns submissions, receipts and retry policy. */
export function ActionButton({
  state = "ready",
  label,
  hint,
  icon = "arrow",
  busy = false,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Button>, "children" | "aria-label" | "aria-busy"> & {
  state?: ActionButtonState | undefined;
  label: string;
  hint?: string | undefined;
  icon?: IconName | undefined;
  busy?: boolean | undefined;
}) {
  const description = useId();
  const failed = state === "error" || state === "unknown";
  const glyph =
    state === "success"
      ? "check"
      : failed
        ? icon === "x"
          ? "x"
          : "alert"
        : state === "wallet"
          ? "wallet"
          : state === "waiting"
            ? "clock"
            : icon;
  return (
    <div className="pk-action" data-state={state}>
      <Button
        {...props}
        block
        className={["pk-action-button", className].filter(Boolean).join(" ")}
        aria-label={label}
        aria-describedby={hint ? description : undefined}
        aria-busy={busy}
      >
        {busy && <span className="pk-action-sweep" aria-hidden="true" />}
        <span key={`${state}.${label}`} className="pk-action-content" aria-hidden="true">
          <span className="pk-action-mark">
            {state === "working" ? (
              <span className="pk-action-ring" />
            ) : (
              <Icon name={glyph} size={19} />
            )}
          </span>
          <span className="pk-action-words">
            <span>{label}</span>
            {hint && <span className="pk-action-hint">{hint}</span>}
          </span>
        </span>
      </Button>
      <span className="pk-action-announcement" role="status" aria-atomic="true">
        {failed ? "" : label}
      </span>
      <span id={description} className="pk-action-announcement" role={failed ? "alert" : undefined}>
        {failed ? `${label}. ${hint ?? ""}` : hint}
      </span>
    </div>
  );
}

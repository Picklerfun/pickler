"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

export function Switch({
  children,
  className = "",
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={`pk-switch ${className}`} {...props}>
      <span className="pk-switch-track" aria-hidden="true">
        <SwitchPrimitive.Thumb className="pk-switch-thumb" />
      </span>
      <span>{children}</span>
    </SwitchPrimitive.Root>
  );
}

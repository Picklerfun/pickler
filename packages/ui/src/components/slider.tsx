"use client";

import * as React from "react";
import { cn } from "cn";
import { Slider as SliderPrimitive } from "radix-ui";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  getValueLabel,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  getValueLabel?: (value: number, index: number) => string;
}) {
  const values = value ?? defaultValue ?? [min];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(value === undefined ? {} : { value })}
      min={min}
      max={max}
      className={cn("pk-slider", className)}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track">
        <SliderPrimitive.Range data-slot="slider-range" />
      </SliderPrimitive.Track>
      {values.map((current, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-valuetext={getValueLabel?.(current, index)}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };

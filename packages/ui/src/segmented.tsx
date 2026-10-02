import type { ReactNode } from "react";

/**
 * A row of exclusive options inside one track: buy or sell, grid or table. It is the shape to
 * reach for when the options are two or three, always visible, and one of them is always on —
 * a filter that can be off is a Chip, and an action that does something is a Button.
 *
 * Tone says what the choice means. `ink` is a view of the same data; `lime` is a side you are
 * taking, so it reads as loud as the money it moves.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = "ink",
  className,
  optionClassName,
  disabled = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for a screen reader: "Side", "Layout". */
  label: string;
  tone?: "ink" | "lime" | undefined;
  className?: string | undefined;
  optionClassName?: string | undefined;
  /** Every option shut, while what the choice belongs to is busy. */
  disabled?: boolean | undefined;
}) {
  return (
    <span
      className={className ? `pk-segmented ${className}` : "pk-segmented"}
      data-tone={tone}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={optionClassName ? `pk-segment ${optionClassName}` : "pk-segment"}
          // The value is on the element so a feature can tint one option differently — Ask is
          // violet and Trade is lime in the same track — without counting children in CSS.
          data-value={option.value}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

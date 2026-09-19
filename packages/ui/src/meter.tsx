/**
 * A filled track: progress along a bonding curve, a reputation score, a trait. It is a reading of
 * one number between 0 and 100, never a control and never a chart.
 *
 * Tone carries the meaning the surface already gives the figure beside it: lime for what landed or
 * graduated, amber for what is still on its way, magenta for what went against, cyan for neutral.
 * A meter that repeats a number already written next to it is decoration, so it is announced only
 * when it is given a `label`.
 */

export type MeterTone = "cyan" | "lime" | "amber" | "magenta";

export function Meter({
  value,
  tone = "cyan",
  label,
  className,
}: {
  /** 0 to 100. Anything outside is clamped. */
  value: number;
  tone?: MeterTone | undefined;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <span
      className={className ? `pk-meter ${className}` : "pk-meter"}
      role={label ? "progressbar" : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(percent) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-hidden={label ? undefined : true}
    >
      <span className="pk-meter-fill" data-tone={tone} style={{ width: `${percent}%` }} />
    </span>
  );
}

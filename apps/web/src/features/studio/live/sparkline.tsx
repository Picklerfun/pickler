"use client";
import { useId, useMemo, useState, type PointerEvent } from "react";
import { formatPrice } from "../../markets/lib/format";
import {
  nearestPriceSample,
  priceSamples,
  priceTime,
  sparkPoints,
  type PriceRange,
} from "./run-model";
import styles from "./run.module.css";

/** Decorative trail used by Record; its textual alternative belongs to the caller. */
export function Sparkline({ trail, up }: { trail: readonly number[] | null; up: boolean | null }) {
  const points = trail ? sparkPoints(trail) : "";
  return (
    <svg
      className={styles.spark}
      data-up={up ?? undefined}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {points && (
        <polyline className={styles.sparkLine} points={points} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/** Inspect real samples and their supplied UTC times; legacy trails retain price-only inspection. */
export function PriceTrail({
  trail,
  timestamps,
  market,
  range,
}: {
  trail: readonly number[] | null;
  timestamps: readonly (string | null)[] | null;
  market: string;
  range: PriceRange;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const geometry = useMemo(() => {
    const samples = priceSamples(trail ?? [], timestamps);
    return {
      samples,
      last: samples.at(-1),
      points: samples.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      low: Math.min(...samples.map(({ value }) => value)),
      high: Math.max(...samples.map(({ value }) => value)),
    };
  }, [trail, timestamps]);
  const { samples, last, points, low, high } = geometry;

  if (!last) {
    return <span className={styles.trailEmpty}>{range} history unavailable</span>;
  }

  const up = last.value >= samples[0]!.value;
  const selected = active === null ? null : samples[Math.min(active, samples.length - 1)];
  const point = selected ?? last;
  const time = priceTime(point.at);

  function inspect(event: PointerEvent<HTMLInputElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setActive(nearestPriceSample(samples, (event.clientX - bounds.left) / bounds.width));
  }

  return (
    <div className={styles.priceTrail} data-up={up ?? undefined}>
      <div
        className={styles.trailPlot}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch" && event.buttons === 0) {
            setActive(null);
          }
        }}
      >
        <svg
          className={styles.trailDrawing}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="0"
              y1="0"
              x2="0"
              y2="100"
              gradientUnits="userSpaceOnUse"
            >
              <stop className={styles.trailGradientStop} offset="0%" stopOpacity={0.22} />
              <stop className={styles.trailGradientStop} offset="100%" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon fill={`url(#${gradientId})`} points={`0,100 ${points} 100,100`} />
          <polyline
            className={styles.trailLine}
            points={points}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {selected && (
          <>
            <span
              className={styles.trailGuide}
              style={{ left: `${point.x}%` }}
              aria-hidden="true"
            />
            <span
              className={styles.trailTooltip}
              style={{ left: `clamp(65px, ${point.x}%, calc(100% - 65px))` }}
              aria-hidden="true"
            >
              <span>{formatPrice(point.value)}</span>
              {time && <time dateTime={time.iso}>{time.label}</time>}
            </span>
          </>
        )}
        <span
          className={styles.trailDot}
          style={{ left: `${last.x}%`, top: `${last.y}%` }}
          aria-hidden="true"
        />
        {selected && (
          <span
            className={styles.trailDot}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            aria-hidden="true"
          />
        )}
        <input
          type="range"
          className={styles.trailInput}
          min={0}
          max={samples.length - 1}
          step={1}
          value={active ?? samples.length - 1}
          aria-label={`${market} ${range} price history`}
          aria-valuetext={`${formatPrice(point.value)}${time ? `, ${time.label}` : ""}`}
          onChange={(event) => setActive(Number(event.currentTarget.value))}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            inspect(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActive(null);
              event.currentTarget.blur();
            }
          }}
          onFocus={() => setActive(samples.length - 1)}
          onBlur={() => setActive(null)}
          onPointerMove={(event) => {
            if (event.pointerType !== "touch" || event.buttons === 1) {
              inspect(event);
            }
          }}
        />
      </div>
      <div className={styles.trailRange} aria-hidden="true">
        <span>
          Low <strong>{formatPrice(low)}</strong>
        </span>
        <span>
          High <strong>{formatPrice(high)}</strong>
        </span>
      </div>
    </div>
  );
}

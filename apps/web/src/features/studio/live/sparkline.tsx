"use client";
import { useId, useState } from "react";
import { formatPrice } from "../../markets/lib/format";
import { sparkPoints, sparkSamples } from "./run-model";
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

/** Explore actual price samples only: this wire trail has no per-point timestamps or OHLC. */
export function PriceTrail({
  trail,
  up,
  market,
}: {
  trail: readonly number[] | null;
  up: boolean | null;
  market: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const samples = sparkSamples(trail ?? []);
  const last = samples.at(-1);

  if (!last) {
    return <span className={styles.trailEmpty}>Price history unavailable</span>;
  }

  const selected = active === null ? null : samples[Math.min(active, samples.length - 1)];
  const point = selected ?? last;
  const points = samples.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const low = Math.min(...samples.map(({ value }) => value));
  const high = Math.max(...samples.map(({ value }) => value));

  return (
    <div className={styles.priceTrail} data-up={up ?? undefined}>
      <div
        className={styles.trailPlot}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") {
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
              style={{ left: `${Math.max(16, Math.min(84, point.x))}%` }}
              aria-hidden="true"
            >
              {formatPrice(point.value)}
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
          aria-label={`${market} price history`}
          aria-valuetext={formatPrice(point.value)}
          onChange={(event) => setActive(Number(event.currentTarget.value))}
          onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActive(null);
              event.currentTarget.blur();
            }
          }}
          onFocus={() => setActive(samples.length - 1)}
          onBlur={() => setActive(null)}
          onPointerMove={(event) => {
            if (event.pointerType === "touch") {
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
            setActive(Math.round(fraction * (samples.length - 1)));
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

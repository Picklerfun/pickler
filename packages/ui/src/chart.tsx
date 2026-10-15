"use client";

import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  CrosshairMode,
  LastPriceAnimationMode,
  LineType,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useId, useRef } from "react";
import { TOKEN_MIRROR } from "./tokens";

/**
 * Market data drawn with lightweight-charts, wearing the product's palette. Features pass values;
 * the look — colours, type, grid, crosshair — is decided here so a chart on the dashboard and a
 * chart on the public site cannot drift apart.
 *
 * All charts read their colours from the surrounding surface, so they follow `data-surface`.
 */

export interface Candle {
  /** Bucket start, in milliseconds. */
  at: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Bar {
  /** Bucket start, in milliseconds. */
  at: number;
  value: number;
  /** A bar that reads as a gain; false paints it as a loss. */
  positive?: boolean;
}

const seconds = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

const readTheme = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  // The fallback is the light surface's own value, from the mirror: what a chart draws with if
  // it mounts before the stylesheet has applied.
  const colour = (name: keyof typeof TOKEN_MIRROR.light) =>
    style.getPropertyValue(name).trim() || TOKEN_MIRROR.light[name];
  return {
    ink: colour("--pk-ink-faint"),
    grid: colour("--pk-rule-strong"),
    up: colour("--pk-win"),
    down: colour("--pk-loss"),
    background: colour("--pk-bg"),
    lossFill: style.getPropertyValue("--pk-state-loss-bg").trim() || colour("--pk-rule-strong"),
    fill: style.getPropertyValue("--pk-state-good-bg").trim() || colour("--pk-rule-strong"),
    font: style.getPropertyValue("--pk-font").trim() || "sans-serif",
  };
};

/** Shared chart frame: transparent background, our grid, and a crosshair that follows the data. */
function useChart(
  render: (chart: IChartApi, theme: ReturnType<typeof readTheme>) => void,
  deps: unknown[],
) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element) {
      return;
    }
    const theme = readTheme(element);
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: theme.ink,
        fontFamily: theme.font,
        fontSize: 10,
        // The library's own logo does not belong inside our panels. Its licence asks for the credit
        // to live somewhere in the product instead, so the public footer carries it.
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: theme.ink, width: 1, style: 3, labelBackgroundColor: theme.grid },
        horzLine: { color: theme.ink, width: 1, style: 3, labelBackgroundColor: theme.grid },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    render(chart, theme);
    chart.timeScale().fitContent();
    return () => chart.remove();
    // The caller owns what goes on the chart; deps say when to draw it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return holder;
}

/** Price history. `precision` is how many decimals the pair needs. */
export function CandleChart({
  candles,
  height = 260,
  precision = 4,
  label,
}: {
  candles: Candle[];
  height?: number;
  precision?: number;
  label?: string;
}) {
  const holder = useChart(
    (chart, theme) => {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: theme.up,
        downColor: theme.down,
        borderVisible: false,
        wickUpColor: theme.up,
        wickDownColor: theme.down,
        priceFormat: { type: "price", precision, minMove: Number(`1e-${precision}`) },
      });
      series.setData(
        candles.map((candle): CandlestickData<Time> => ({
          time: seconds(candle.at),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
    },
    [candles, precision],
  );

  return <div ref={holder} style={{ height }} role="img" aria-label={label ?? "Price history"} />;
}

/** One bar per bucket: settled picks a day, money at risk a day. */
export function BarChart({
  bars,
  height = 120,
  label,
}: {
  bars: Bar[];
  height?: number;
  label?: string;
}) {
  const holder = useChart(
    (chart, theme) => {
      const series = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        priceFormat: { type: "volume" },
      });
      series.setData(
        bars.map((bar): HistogramData<Time> => ({
          time: seconds(bar.at),
          value: bar.value,
          color: bar.positive === false ? theme.down : theme.up,
        })),
      );
    },
    [bars],
  );

  return <div ref={holder} style={{ height }} role="img" aria-label={label ?? "Activity"} />;
}

/** A price line with a fading area. Values are supplied by the consumer, never calculated here. */
export interface PricePoint {
  /** Sample timestamp in milliseconds. */
  at: number;
  value: number;
}

export function AreaChart({
  points,
  height = 280,
  precision = 6,
  label = "Price history",
  currency = "",
  variant = "default",
  trend = "up",
}: {
  points: readonly PricePoint[];
  height?: number;
  precision?: number;
  label?: string;
  currency?: string;
  variant?: "default" | "market" | "sparkline";
  trend?: "up" | "down" | "flat";
}) {
  const holder = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const tooltipPrice = useRef<HTMLElement>(null);
  const tooltipTime = useRef<HTMLElement>(null);
  const model = useRef<{
    chart: IChartApi;
    series: ISeriesApi<"Area">;
    fit: () => void;
    inspect: (point: PricePoint) => void;
  } | null>(null);
  const observations = useRef<readonly PricePoint[]>([]);
  const signature = useRef("");
  const selection = useRef(-1);
  const tooltipId = useId();
  const interactive = variant === "market";

  useEffect(() => {
    const element = holder.current;
    if (!element) {
      return;
    }
    const theme = readTheme(element);
    const compact = variant === "sparkline";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: theme.ink,
        fontFamily: theme.font,
        fontSize: variant === "default" ? 10 : 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: {
          visible: !compact,
          color: getComputedStyle(element).getPropertyValue("--pk-rule").trim() || theme.grid,
        },
      },
      rightPriceScale: {
        visible: !compact,
        borderVisible: false,
        scaleMargins: { top: interactive ? 0.18 : 0.12, bottom: 0.12 },
      },
      timeScale: {
        visible: !compact,
        borderVisible: false,
        timeVisible: true,
        rightOffset: 0,
        minBarSpacing: 0.1,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        mode: compact ? CrosshairMode.Hidden : CrosshairMode.Magnet,
        vertLine: {
          color: theme.ink,
          width: 1,
          style: 3,
          labelVisible: !interactive,
          labelBackgroundColor: theme.grid,
        },
        horzLine: {
          visible: !interactive,
          color: theme.grid,
          labelVisible: !interactive,
          labelBackgroundColor: theme.grid,
        },
      },
      handleScroll: variant === "default",
      handleScale: variant === "default" ? { axisPressedMouseMove: false } : false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: theme.up,
      topColor: theme.fill,
      bottomColor: theme.background,
      lineWidth: compact ? 1 : 2,
      // This is a visual interpolation through observations, not additional price samples.
      lineType: variant === "default" ? LineType.Simple : LineType.Curved,
      priceLineVisible: false,
      lastValueVisible: interactive,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: theme.background,
      crosshairMarkerBackgroundColor: theme.up,
      lastPriceAnimation:
        interactive && !reducedMotion.matches
          ? LastPriceAnimationMode.OnDataUpdate
          : LastPriceAnimationMode.Disabled,
      priceFormat: { type: "price", precision, minMove: Number(`1e-${precision}`) },
    });
    const fit = () => {
      const count = observations.current.length;
      if (variant === "default" || count < 2) {
        chart.timeScale().fitContent();
      } else {
        chart.timeScale().setVisibleLogicalRange({ from: 0.45, to: count - 1.45 });
      }
    };
    const renderTooltip = (point: PricePoint, x: number, y: number) => {
      const box = tooltip.current;
      if (!box) {
        return;
      }
      if (tooltipPrice.current) {
        tooltipPrice.current.textContent = `${point.value.toFixed(precision)} ${currency}`.trim();
      }
      if (tooltipTime.current) {
        tooltipTime.current.textContent =
          new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "UTC",
          }).format(new Date(point.at)) + " UTC";
      }
      const width = box.offsetWidth;
      const plotWidth = chart.timeScale().width();
      const left = Math.max(4, Math.min(x - width / 2, plotWidth - width - 4));
      const top = Math.max(
        8,
        Math.min(y - box.offsetHeight - 18, element.clientHeight - box.offsetHeight - 40),
      );
      box.style.transform = `translate(${left}px, ${top}px)`;
      box.dataset.visible = "true";
    };
    model.current = {
      chart,
      series,
      fit,
      inspect: (point) => {
        chart.setCrosshairPosition(point.value, seconds(point.at), series);
        const x = chart.timeScale().timeToCoordinate(seconds(point.at));
        const y = series.priceToCoordinate(point.value);
        if (x !== null && y !== null) {
          renderTooltip(point, x, y);
        }
      },
    };
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    const motionChanged = () => {
      if (reducedMotion.matches) {
        element.getAnimations().forEach((animation) => animation.cancel());
      }
      series.applyOptions({
        lastPriceAnimation:
          interactive && !reducedMotion.matches
            ? LastPriceAnimationMode.OnDataUpdate
            : LastPriceAnimationMode.Disabled,
      });
    };
    reducedMotion.addEventListener("change", motionChanged);
    chart.subscribeCrosshairMove((event) => {
      const box = tooltip.current;
      if (!interactive || !box) {
        return;
      }
      const datum = event.seriesData.get(series);
      if (
        !event.point ||
        !event.time ||
        !datum ||
        !("value" in datum) ||
        event.point.x < 0 ||
        event.point.y < 0 ||
        event.point.y >= element.clientHeight
      ) {
        box.dataset.visible = "false";
        return;
      }
      const point = observations.current.find((item) => seconds(item.at) === event.time);
      if (!point) {
        box.dataset.visible = "false";
        return;
      }
      selection.current = observations.current.indexOf(point);
      renderTooltip(point, event.point.x, series.priceToCoordinate(point.value) ?? event.point.y);
    });
    return () => {
      resize.disconnect();
      reducedMotion.removeEventListener("change", motionChanged);
      chart.remove();
      model.current = null;
      signature.current = "";
    };
  }, [currency, interactive, precision, variant]);

  useEffect(() => {
    const current = model.current;
    const element = holder.current;
    if (!current || !element) {
      return;
    }
    const theme = readTheme(element);
    const line = { up: theme.up, down: theme.down, flat: theme.ink }[trend];
    const fill = { up: theme.fill, down: theme.lossFill, flat: theme.background }[trend];
    current.series.applyOptions({
      lineColor: line,
      topColor: fill,
      crosshairMarkerBackgroundColor: line,
    });
    const next = JSON.stringify(points);
    if (signature.current === next) {
      return;
    }
    signature.current = next;
    observations.current = points;
    selection.current = points.length - 1;
    current.series.setData(
      points.map((point) => ({ time: seconds(point.at), value: point.value })),
    );
    current.fit();
    // Auto-size resolves after mount; fit again after the library knows the plot width.
    const frame = requestAnimationFrame(current.fit);
    if (tooltip.current) {
      tooltip.current.dataset.visible = "false";
    }
    if (variant !== "default" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      holder.current?.getAnimations().forEach((animation) => animation.cancel());
      holder.current?.animate(
        [
          { opacity: 0.3, clipPath: "inset(0 100% 0 0)" },
          { opacity: 1, clipPath: "inset(0 0 0 0)" },
        ],
        { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
    return () => cancelAnimationFrame(frame);
  }, [points, precision, currency, variant, trend]);

  function selectPoint(index: number) {
    const point = observations.current[index];
    if (point && model.current) {
      selection.current = index;
      model.current.inspect(point);
    }
  }

  return (
    <div className="pk-price-chart" data-chart-variant={variant} data-chart-trend={trend}>
      <div
        ref={holder}
        className="pk-price-plot"
        style={{ height }}
        role="img"
        aria-label={
          interactive ? `${label}. Use left and right arrows to inspect observations.` : label
        }
        aria-describedby={interactive ? tooltipId : undefined}
        tabIndex={interactive ? 0 : undefined}
        onFocus={() => selectPoint(observations.current.length - 1)}
        onBlur={() => {
          model.current?.chart.clearCrosshairPosition();
          if (tooltip.current) {
            tooltip.current.dataset.visible = "false";
          }
        }}
        onKeyDown={(event) => {
          if (!interactive) {
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const step = event.key === "ArrowLeft" ? -1 : 1;
            selectPoint(
              Math.max(0, Math.min(selection.current + step, observations.current.length - 1)),
            );
          } else if (event.key === "Escape") {
            model.current?.chart.clearCrosshairPosition();
            if (tooltip.current) {
              tooltip.current.dataset.visible = "false";
            }
          }
        }}
      />
      {interactive && (
        <div
          ref={tooltip}
          id={tooltipId}
          className="pk-price-tooltip"
          data-visible="false"
          role="tooltip"
        >
          <strong ref={tooltipPrice} />
          <span ref={tooltipTime} />
        </div>
      )}
    </div>
  );
}

"use client";

import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { TOKEN_MIRROR } from "./tokens";

/**
 * Market data drawn with lightweight-charts, wearing the product's palette. Features pass values;
 * the look — colours, type, grid, crosshair — is decided here so a chart on the dashboard and a
 * chart on the public site cannot drift apart.
 *
 * Both charts read their colours from the surrounding surface, so they follow `data-surface`.
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

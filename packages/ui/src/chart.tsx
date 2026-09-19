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
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: value("--pk-ink-faint", "#8891b5"),
    grid: value("--pk-border", "rgba(245, 246, 255, 0.08)"),
    up: value("--pk-lime", "#c8f03a"),
    down: value("--pk-magenta", "#ff5fa2"),
    font: value("--pk-font-mono", "monospace"),
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

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PerplDashboardMarketsDto } from "@pickler/api-schema";
import { Button, Icon } from "@pickler/ui";
import { marketHref, percent, price, tone } from "./display";
import { MarketAsset, marketIdentity } from "./market-asset";
import styles from "./market-ticker.module.css";

type Market = PerplDashboardMarketsDto["markets"][number];

export function MarketTicker({
  market,
  stale,
  preview,
}: {
  market: PerplDashboardMarketsDto | null;
  stale: boolean;
  preview: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [moving, setMoving] = useState(false);
  const windowElement = useRef<HTMLDivElement>(null);
  const groupElement = useRef<HTMLDivElement>(null);
  const markets = market?.markets ?? [];
  const label = preview ? "Demo markets" : stale ? "Last snapshot" : "Perpl markets";

  useEffect(() => {
    const viewport = windowElement.current;
    const group = groupElement.current;
    if (!viewport || !group) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setMoving(group.getBoundingClientRect().width > viewport.clientWidth);
    });
    observer.observe(viewport);
    observer.observe(group);
    return () => observer.disconnect();
  }, [markets.length]);

  return (
    <section
      className={styles.ticker}
      data-surface="dark"
      data-paused={paused || stale}
      data-manual={manual}
      data-moving={moving}
      aria-label="Perpl market prices in AUSD and 24-hour changes"
    >
      <div className={styles.caption}>
        <span className={styles.dot} data-stale={stale} aria-hidden="true" />
        <span>{label}</span>
        <small>AUSD · 24h</small>
      </div>
      {markets.length ? (
        <div
          className={styles.window}
          ref={windowElement}
          onPointerDown={(event) => {
            if (event.pointerType === "touch") {
              setManual(true);
            }
          }}
        >
          <div className={styles.track}>
            <div className={styles.group} ref={groupElement}>
              {markets.map((item) => (
                <Link className={styles.item} key={item.id} href={marketHref(item.symbol)}>
                  <MarketQuote item={item} />
                </Link>
              ))}
            </div>
            <div className={styles.clone} aria-hidden="true" inert>
              {markets.map((item) => (
                <span className={styles.item} key={item.id}>
                  <MarketQuote item={item} />
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className={styles.unavailable} role="status">
          {market
            ? "No open markets"
            : stale
              ? "Market prices unavailable"
              : "Loading market prices…"}
        </p>
      )}
      {markets.length ? (
        <Button
          variant="ghost"
          size="sm"
          className={styles.pause}
          aria-label={paused ? "Resume market ticker" : "Pause market ticker"}
          aria-pressed={paused}
          title={paused ? "Resume market ticker" : "Pause market ticker"}
          onClick={() => {
            setPaused(!paused);
            setManual(false);
          }}
        >
          <Icon name={paused ? "play" : "pause"} size={16} />
        </Button>
      ) : null}
    </section>
  );
}

function MarketQuote({ item }: { item: Market }) {
  const movement = tone(item.change24hBps);
  return (
    <>
      <MarketAsset symbol={item.symbol} />
      <strong>{marketIdentity(item.symbol).ticker}</strong>
      <MarketPrice value={item.price} />
      <span className={styles.change} data-tone={movement}>
        {movement !== "neutral" ? (
          <Icon name={movement === "loss" ? "arrowDown" : "arrowUp"} size={14} />
        ) : null}
        {percent(item.change24hBps, true)}
      </span>
    </>
  );
}

function MarketPrice({ value }: { value: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const node = element.current;
    if (!node || Number(before) === Number(value)) {
      return;
    }
    const tokens = getComputedStyle(node);
    const rising = Number(value) > Number(before);
    let backgroundToken = "--pk-state-loss-bg";
    let foregroundToken = "--pk-loss";
    if (rising) {
      backgroundToken = "--pk-state-win-bg";
      foregroundToken = "--pk-win";
    }
    const animation = node.animate(
      [
        {
          backgroundColor: tokens.getPropertyValue(backgroundToken),
          color: tokens.getPropertyValue(foregroundToken),
        },
        {
          backgroundColor: tokens.getPropertyValue("--pk-bg"),
          color: tokens.getPropertyValue("--pk-ink"),
        },
      ],
      { duration: 650, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [value]);

  return (
    <span className={styles.price} ref={element}>
      {price(value)}
    </span>
  );
}

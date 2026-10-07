"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PerplMarketCatalogDto } from "@pickler/api-schema";
import { Button, Chip, Field, Input, Skeleton, Tag } from "@pickler/ui";
import { studioPerplMarkets } from "../api";
import styles from "./trading-markets.module.css";

type Network = "testnet" | "mainnet";
/** Deliberately controlled preview evidence, never a fallback for a live catalogue. */
function previewCatalog(network: Network): PerplMarketCatalogDto {
  return {
    network,
    observedAt: Date.now(),
    markets: ["BTC", "ETH", "SOL"].map((symbol, index) => ({
      marketId: index + 1,
      symbol,
      name: `${symbol} Perp`,
      collateral: { symbol: "AUSD", decimals: 6 },
      status: "open",
      available: true,
      reasons: [],
    })),
  };
}
export function useTradingMarkets(network: Network | null, preview: boolean) {
  const [savedCatalog, setCatalog] = useState<PerplMarketCatalogDto | null>(() =>
    preview && network ? previewCatalog(network) : null,
  );
  const [savedPhase, setPhase] = useState<"loading" | "ready" | "error">(
    preview && network ? "ready" : "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [readKey, setReadKey] = useState("");
  const queryKey = `${network}:${attempt}`;
  const previewRead = useMemo(
    () => (preview && network ? previewCatalog(network) : null),
    [preview, network],
  );
  const catalog = previewRead ?? savedCatalog;
  const phase = !network
    ? "error"
    : preview
      ? "ready"
      : readKey === queryKey
        ? savedPhase
        : "loading";
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!network || preview) {
      return;
    }
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    void studioPerplMarkets(network, controller.signal).then(
      (read) => {
        if (controller.signal.aborted) {
          return;
        }
        setReadKey(queryKey);
        const age = Date.now() - read.observedAt;
        if (read.network !== network || age > 30000 || age < -5000) {
          setPhase("error");
          return;
        }
        setCatalog(read);
        setPhase("ready");
        expiry = setTimeout(() => setPhase("error"), Math.max(1, 30000 - age));
      },
      () => {
        if (!controller.signal.aborted) {
          setReadKey(queryKey);
          setPhase("error");
        }
      },
    );
    return () => {
      controller.abort();
      clearTimeout(expiry);
    };
  }, [network, preview, queryKey]);
  const ready = phase === "ready" && catalog?.network === network;
  const allows = (symbols: readonly string[]) =>
    ready &&
    symbols.length > 0 &&
    symbols.every((symbol) => {
      const rows = catalog!.markets.filter((row) => row.symbol === symbol);
      return rows.length === 1 && rows[0]!.available;
    });
  return { catalog, phase, retry, ready, allows };
}
export type TradingMarketsRead = ReturnType<typeof useTradingMarkets>;
export function TradingMarkets({
  read,
  network,
  value,
  onChange,
  disabled = false,
}: {
  read: TradingMarketsRead;
  network: Network | null;
  value: readonly string[];
  onChange(value: string[]): void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const rows = read.catalog?.network === network ? read.catalog.markets : [];
  const visible = rows.filter((row) =>
    `${row.symbol ?? ""} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className={styles.panel} aria-label="Trading markets">
      <div className={styles.head}>
        <h3>Trading markets</h3>
        <Tag>{network ? `Monad ${network}` : "Network unavailable"}</Tag>
      </div>
      <p>
        Choose the markets this agent may open positions in. New listings are never selected
        automatically.
      </p>
      <Field label="Find a market">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search symbols or names"
        />
      </Field>
      <div className={styles.selected} aria-label="Selected trading markets">
        {value.length ? (
          value.map((symbol) => (
            <Chip
              key={symbol}
              selected
              disabled={disabled}
              onClick={() => onChange(value.filter((item) => item !== symbol))}
            >
              {symbol} · Remove
            </Chip>
          ))
        ) : (
          <span>No markets selected</span>
        )}
      </div>
      {read.phase === "loading" && (
        <div
          role="status"
          aria-label="Loading Perpl markets"
          aria-busy="true"
          className={styles.loading}
        >
          <Skeleton shape="button" />
          <Skeleton shape="button" />
          <Skeleton shape="button" />
        </div>
      )}
      {(read.phase === "error" || !network) && (
        <div role="alert">
          <p>
            The current catalogue could not be confirmed. Saved markets are preserved; new
            selections need a fresh catalogue.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={!network || disabled}
            onClick={read.retry}
          >
            Retry catalogue
          </Button>
        </div>
      )}
      <ul className={styles.list} aria-label="Perpl market catalogue">
        {visible.map((row, index) => {
          const selected = row.symbol !== null && value.includes(row.symbol);
          const shut = disabled || !read.ready || !row.available || row.symbol === null;
          return (
            <li key={`${row.marketId ?? "invalid"}-${index}`}>
              <Chip
                selected={selected}
                disabled={shut}
                onClick={() => {
                  if (row.symbol) {
                    onChange(
                      selected
                        ? value.filter((symbol) => symbol !== row.symbol)
                        : [...value, row.symbol],
                    );
                  }
                }}
              >
                {row.symbol ?? row.name}
              </Chip>
              <span>
                {row.collateral?.symbol ?? "Unknown collateral"} · {row.status}
                {row.reasons.length ? ` · ${row.reasons.join("; ")}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {read.ready && visible.length === 0 && <p>No matching markets.</p>}
      <p>
        Changing markets requires new preparation and turns scheduling off. Removing a market
        preserves supervision and closing of its existing positions. Funding a wallet does not
        enable execution.
      </p>
    </section>
  );
}

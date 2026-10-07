"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PerplMarketCatalogDto } from "@pickler/api-schema";
import { Button, Chip, Icon, Input, Skeleton, Tag } from "@pickler/ui";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pickler/ui/dropdown-menu";
import { studioPerplMarkets } from "../api";
import styles from "./trading-markets.module.css";
import testnetCatalogue from "./perpl-testnet-catalogue.fixture.json";

type Network = "testnet" | "mainnet";
/**
 * Captured from Perpl's public context through the production catalogue adapter.
 * Preview-only: the live read never falls back to this captured catalogue.
 */
function previewCatalog(network: Network): PerplMarketCatalogDto {
  const captured = testnetCatalogue as PerplMarketCatalogDto;
  return {
    network,
    observedAt: Date.now(),
    markets: network === captured.network ? structuredClone(captured.markets) : [],
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
      {read.phase === "loading" ? (
        <div role="status" aria-label="Loading Perpl markets" aria-busy="true">
          <Skeleton shape="button" className={styles.placeholder} />
        </div>
      ) : (
        <DropdownMenu onOpenChange={() => setSearch("")}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              className={styles.trigger}
              disabled={disabled || !read.ready}
              aria-label="Select trading markets"
            >
              <span>{value.length ? `${value.length} selected` : "Select markets"}</span>
              <Icon name="chevronsUpDown" size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-surface="dark" className={styles.menu} align="start">
            <div className={styles.search}>
              <Input
                aria-label="Search markets"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  // Keep typing/editing in the input; Radix still handles menu navigation.
                  if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)) {
                    event.stopPropagation();
                  }
                }}
                placeholder="Search markets…"
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuGroup className={styles.options} aria-label="Perpl market catalogue">
              {visible.map((row, index) => {
                const symbol = row.symbol;
                const selected = symbol !== null && value.includes(symbol);
                return (
                  <DropdownMenuCheckboxItem
                    key={`${row.marketId ?? "invalid"}-${index}`}
                    checked={selected}
                    disabled={disabled || !read.ready || !row.available || symbol === null}
                    textValue={symbol ?? row.name}
                    aria-label={symbol ?? row.name}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      if (symbol) {
                        onChange(
                          checked ? [...value, symbol] : value.filter((item) => item !== symbol),
                        );
                      }
                    }}
                  >
                    <span className={styles.option}>
                      <span>{symbol ?? row.name}</span>
                      {!row.available && (
                        <span className={styles.detail}>
                          {row.reasons.join("; ") || row.status}
                        </span>
                      )}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
            {visible.length === 0 && <p className={styles.empty}>No matching markets.</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className={styles.selected} aria-label="Selected trading markets">
        {value.length ? (
          value.map((symbol) => (
            <Chip
              key={symbol}
              selected
              disabled={disabled}
              aria-label={`${symbol} · Remove`}
              onClick={() => onChange(value.filter((item) => item !== symbol))}
            >
              {symbol}
              <Icon name="x" size={14} />
            </Chip>
          ))
        ) : (
          <span>No markets selected</span>
        )}
      </div>
      {(read.phase === "error" || !network) && (
        <div role="alert">
          <p>Catalogue unavailable. Your selected markets are unchanged.</p>
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
      <p>Changes pause scheduling and require a new readiness check.</p>
    </section>
  );
}

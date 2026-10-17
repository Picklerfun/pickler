"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentTokenDto, TokenMarketDto } from "@pickler/api-schema";
import { AreaChart, Button, Icon, Meter, Skeleton, Tag } from "@pickler/ui";
import { AgentAvatar } from "@/features/studio/shell/agent-avatar";
import {
  marketAmount,
  readTokenMarket,
  tokenMarketRead,
  tokenPricePoints,
  type TokenMarketRead,
} from "@/features/tokens/market-data";
import previewMarket from "@/features/tokens/market-preview.json";
import styles from "./token-market.module.css";

export type TokenListing = { handle: string; token: AgentTokenDto };

function PriceMovement({ move }: { move: TokenMarketDto["priceMovement"] }) {
  if (!move) {
    return null;
  }
  const down = move.direction === "down";
  const flat = move.direction === "flat";
  const bps = move.changeBps.replace(/^-/, "");
  const value = bps === "0" && !flat ? "<0.01" : marketAmount(bps, 2, 2);
  const prefix = bps === "0" ? "" : { flat: "", down: "−", up: "+" }[move.direction];
  const from = new Date(move.fromAt).toLocaleString("en-US", { timeZone: "UTC" });
  const to = new Date(move.toAt).toLocaleString("en-US", { timeZone: "UTC" });
  return (
    <Tag
      className={styles.movement}
      data-tint={{ flat: "grey", down: "magenta", up: "lime" }[move.direction]}
      aria-label={`Last observed price move: ${move.direction}, ${value} percent`}
      title={`Last observed price move · ${from} to ${to} UTC. Not a 24h return.`}
    >
      {!flat && <Icon name={down ? "arrowDown" : "arrowUp"} size={12} />}
      {prefix}
      {value}%
    </Tag>
  );
}

function MarketRow({ listing, preview }: { listing: TokenListing; preview: boolean }) {
  const { handle, token } = listing;
  const [read, setRead] = useState<TokenMarketRead | null>(() =>
    preview ? tokenMarketRead.parse(previewMarket) : null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    preview ? "ready" : "loading",
  );
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (preview) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let active = true;
    async function load() {
      try {
        const result = await readTokenMarket(
          { address: token.address, chainId: token.chainId },
          controller.signal,
        );
        if (active) {
          setRead(result);
          setStatus("ready");
        }
      } catch {
        if (active) {
          setStatus("error");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [token.address, token.chainId, request, preview]);

  const market = read?.data.market;
  const points = tokenPricePoints(market?.history ?? []);
  const symbol = read?.data.quote.symbol;
  const href = `/agents/${encodeURIComponent(handle)}${preview ? "?stage=token-launched" : ""}`;
  const loading = status === "loading" && !read;
  const ticker = token.ticker.replace(/^\$+/, "");
  return (
    <tr className={styles.row} data-market-row aria-busy={status === "loading"}>
      <td className={styles.tokenCell}>
        <Link href={href} className={styles.identity}>
          <AgentAvatar accent={token.avatar.accent} pattern={token.avatar.pattern} size="chip" />
          <span className={styles.name}>
            <strong>{token.name}</strong>
            <span>${ticker}</span>
          </span>
        </Link>
        {status === "error" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("loading");
              setRequest((value) => value + 1);
            }}
          >
            Retry metrics
          </Button>
        ) : !preview && read?.stale ? (
          <small className={styles.freshness}>Index catching up</small>
        ) : status === "ready" && !market ? (
          <small className={styles.freshness}>Metrics pending</small>
        ) : null}
      </td>
      <td className={styles.priceCell} data-label={`Curve price · ${symbol ?? "AUSD"}`}>
        <div className={styles.priceLayout}>
          <span className={styles.figure}>
            {loading ? <Skeleton /> : marketAmount(market?.priceWad, 18, 8)}
          </span>
          {symbol && symbol !== "AUSD" && <small>{symbol}</small>}
          {points.length > 1 && (
            <div className={styles.sparkline}>
              <AreaChart
                points={points}
                height={28}
                precision={8}
                variant="sparkline"
                trend={market?.priceMovement?.direction ?? "flat"}
                label={`${token.name} observed price trend`}
              />
            </div>
          )}
          <PriceMovement move={market?.priceMovement} />
        </div>
      </td>
      <td className={styles.fdvCell} data-label={`FDV · ${symbol ?? "AUSD"}`}>
        <small className={styles.mobileLabel} aria-hidden="true">
          FDV
        </small>
        <span className={styles.figure}>
          {loading ? <Skeleton /> : marketAmount(market?.fdvWad, 18, 2)}
        </span>
      </td>
      <td className={styles.volumeCell} data-label={`Curve volume · 24h · ${symbol ?? "AUSD"}`}>
        <small className={styles.mobileLabel} aria-hidden="true">
          24h volume
        </small>
        <span className={styles.figure}>
          {loading ? (
            <Skeleton />
          ) : (
            marketAmount(market?.volume24h, read?.data.quote.decimals ?? 6, 2)
          )}
        </span>
      </td>
      <td className={styles.curveCell} data-label="Curve">
        <small className={styles.mobileLabel} aria-hidden="true">
          Curve
        </small>
        {market?.progressBps !== null && market?.progressBps !== undefined ? (
          <div className={styles.curveMetric}>
            <Meter
              value={market.progressBps / 100}
              tone="lime"
              label={`${token.name} curve supply sold`}
            />
            <span>{(market.progressBps / 100).toLocaleString("en-US")}%</span>
          </div>
        ) : loading ? (
          <Skeleton />
        ) : (
          <span className={styles.figure}>—</span>
        )}
      </td>
      <td className={styles.actionCell}>
        <Link href={href} className={styles.tradeLink} aria-label={`Trade ${token.name}`}>
          <Icon name="arrow" size={18} />
        </Link>
      </td>
    </tr>
  );
}

export function TokenMarketBoard({
  listings,
  preview = false,
}: {
  listings: TokenListing[];
  preview?: boolean;
}) {
  return (
    <div className={styles.board}>
      <div className={styles.scroller} role="region" aria-label="Token markets">
        <table role="table" aria-label="Confirmed agent token markets">
          <thead>
            <tr>
              <th>Token</th>
              <th>Curve price</th>
              <th>
                <abbr title="Fully diluted valuation">FDV</abbr>
              </th>
              <th>24h volume</th>
              <th>Curve</th>
              <th>
                <span className={styles.srOnly}>Trade</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <MarketRow
                key={`${listing.token.chainId}:${listing.token.address}`}
                listing={listing}
                preview={preview}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.boardFoot}>
        <span>{preview ? "Local preview · No transactions" : "Confirmed on-chain"}</span>
        <span>
          {listings.length} {listings.length === 1 ? "token" : "tokens"}
        </span>
      </div>
    </div>
  );
}

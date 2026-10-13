"use client";
import { useEffect, useState } from "react";
import {
  perplDashboardMarketsSchema,
  perplPortfolioSchema,
  type PerplDashboardMarketsDto,
  type PerplPortfolioDto,
} from "@pickler/api-schema";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import { PerplReadError, perplRequest } from "./client";
import { apiClock } from "../../lib/server-clock";

export function usePerplDashboard() {
  const wallet = useWallet();
  const address = wallet.address?.toLowerCase() ?? "";
  const [market, setMarket] = useState<PerplDashboardMarketsDto | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<{ address: string; data: PerplPortfolioDto } | null>(
    null,
  );
  const [error, setError] = useState<{ address: string; message: string } | null>(null);
  const [now, setNow] = useState(() => apiClock.now());
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const run = async () => {
      if (disposed || document.hidden) {
        return;
      }
      const request = new AbortController();
      controller = request;
      try {
        const data = await perplRequest("markets", perplDashboardMarketsSchema, request.signal);
        if (!disposed) {
          setMarket(data);
          setMarketError(null);
          setNow(apiClock.now());
        }
      } catch (e) {
        if (!disposed && !request.signal.aborted) {
          setMarketError(
            e instanceof PerplReadError
              ? e.message
              : "Perpl is not responding. Updates will retry shortly.",
          );
        }
      } finally {
        if (!disposed && !document.hidden && !request.signal.aborted && controller === request) {
          timer = setTimeout(run, 10_000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) {
        void run();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void run();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (!address) {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const run = async () => {
      if (disposed || document.hidden) {
        return;
      }
      const request = new AbortController();
      controller = request;
      let delay = 5000;
      try {
        const data = await perplRequest(
          `portfolio/${address}`,
          perplPortfolioSchema,
          request.signal,
        );
        if (data.wallet.toLowerCase() !== address || data.source !== "onchain") {
          throw new PerplReadError("INVALID_RESPONSE", "The snapshot could not be verified.");
        }
        if (!disposed && !request.signal.aborted) {
          setPortfolio({ address, data });
          setError(null);
          setNow(apiClock.now());
        }
      } catch (e) {
        if (!disposed && !request.signal.aborted) {
          setError({
            address,
            message:
              e instanceof PerplReadError
                ? e.message
                : "The on-chain snapshot is unavailable. Updates will retry shortly.",
          });
          delay = 30_000;
        }
      } finally {
        if (!disposed && !document.hidden && !request.signal.aborted && controller === request) {
          timer = setTimeout(run, delay);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) {
        void run();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void run();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [address]);
  return {
    wallet,
    market,
    marketError,
    portfolio: address && portfolio?.address === address ? portfolio.data : null,
    error: address && error?.address === address ? error.message : null,
    now,
  };
}

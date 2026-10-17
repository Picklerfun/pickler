"use client";

import { useEffect, useState } from "react";
import {
  publicTokenTradeQuotedSchema,
  type PublicTokenTradeQuotedDto,
  type PublicTokenTradeInputDto,
} from "@pickler/api-schema";

export async function readPublicTradeQuote(
  handle: string,
  token: string,
  input: PublicTokenTradeInputDto,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<PublicTokenTradeQuotedDto> {
  const response = await request(
    `/api/v1/marketplace/personas/${encodeURIComponent(handle)}/token/quote`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error("Quote unavailable");
  }
  const quoted = publicTokenTradeQuotedSchema.parse(body);
  if (
    quoted.token.toLowerCase() !== token.toLowerCase() ||
    quoted.quote.side !== input.side ||
    quoted.quote.amount !== input.amount ||
    quoted.quote.slippageBps !== input.slippageBps ||
    Date.parse(quoted.expiresAt) <= Date.now()
  ) {
    throw new Error("Quote does not match this trade");
  }
  return quoted;
}

/** One debounced read per edit. A superseded response can never become the current estimate. */
export function usePublicTradeQuote({
  handle,
  token,
  wallet,
  side,
  amount,
  slippageBps,
  enabled,
  refreshKey,
}: {
  handle: string;
  token: string;
  wallet: string | null;
  side: "buy" | "sell";
  amount: string | null;
  slippageBps: number;
  enabled: boolean;
  refreshKey: string | null;
}) {
  const key = JSON.stringify([handle, token, wallet, side, amount, slippageBps, refreshKey]);
  const [result, setResult] = useState<{
    key: string;
    value: PublicTokenTradeQuotedDto | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !wallet || !amount) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void readPublicTradeQuote(
        handle,
        token,
        { wallet, side, amount, slippageBps },
        controller.signal,
      ).then(
        (value) => {
          if (!controller.signal.aborted) {
            setResult({ key, value });
          }
        },
        () => {
          if (!controller.signal.aborted) {
            setResult({ key, value: null });
          }
        },
      );
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle, token, wallet, side, amount, slippageBps, enabled, key]);
  const current = wallet && amount;
  return {
    quoted: current && result?.key === key ? result.value : null,
    loading: Boolean(enabled && current && result?.key !== key),
    unavailable: Boolean(enabled && current && result?.key === key && result.value === null),
  };
}

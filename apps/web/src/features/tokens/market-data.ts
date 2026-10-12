import type { AgentTokenDto, TokenMarketDto } from "@pickler/api-schema";
import { freshnessReadSchema, launchDetailSchema } from "@pickler/api-schema";
import { formatUnits } from "viem";
import type { PricePoint } from "@pickler/ui";

export const tokenMarketRead = freshnessReadSchema(launchDetailSchema);
export type TokenMarketRead = ReturnType<typeof tokenMarketRead.parse>;

export function marketAmount(value: string | null | undefined, decimals: number, precision = 6) {
  if (value === null || value === undefined) {
    return "—";
  }
  const [whole, fraction = ""] = formatUnits(BigInt(value), decimals).split(".");
  const tail = fraction.slice(0, precision).replace(/0+$/, "");
  return BigInt(whole!).toLocaleString("en-US") + (tail ? `.${tail}` : "");
}

/** Number conversion is only for chart coordinates; monetary figures stay in prepared units. */
export function tokenPricePoints(history: TokenMarketDto["history"]): PricePoint[] {
  const bySecond = new Map<number, number>();
  for (const point of history) {
    const at = Math.floor(Date.parse(point.at) / 1000) * 1000;
    const value = Number(formatUnits(BigInt(point.priceWad), 18));
    if (Number.isFinite(at) && Number.isFinite(value) && value > 0) {
      bySecond.set(at, value);
    }
  }
  return [...bySecond].map(([at, value]) => ({ at, value })).sort((a, b) => a.at - b.at);
}

export async function readTokenMarket(
  token: Pick<AgentTokenDto, "address" | "chainId">,
  signal: AbortSignal,
): Promise<TokenMarketRead | null> {
  const id = `eip155:${token.chainId}:${token.address.toLowerCase()}`;
  const response = await fetch(`/api/v1/launches/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Market read unavailable");
  }
  const read = tokenMarketRead.parse(await response.json());
  if (
    read.data.address.toLowerCase() !== token.address.toLowerCase() ||
    read.data.chainId !== `eip155:${token.chainId}` ||
    !["pre_graduation", "graduated"].includes(read.data.phase)
  ) {
    throw new Error("Market identity mismatch");
  }
  return read;
}

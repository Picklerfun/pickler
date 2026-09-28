import { createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPerplSession } from "@pickler/agent-runtime/composition/perpl";
import {
  PilotError,
  PERPL_PLUGIN_VERSION,
  type AgentRecord,
  type Scope,
  type PerpSnapshot,
  type PerpOrderBook,
} from "@pickler/core";
import type { PerplDataOptions } from "@pickler/infrastructure";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function capturePerplData(input: {
  repository: { agent(scope: Scope): Promise<AgentRecord> };
  scope: Scope;
  root: string;
  attempt: string;
  signal: AbortSignal;
  options?: PerplDataOptions;
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.attempt)) {
    throw new PilotError("INVALID_INPUT", "Use a unique alphanumeric attempt name");
  }
  const agent = structuredClone(await input.repository.agent(input.scope));
  if (agent.id !== input.scope.agentId || agent.tenantId !== input.scope.tenantId) {
    throw new PilotError("FORBIDDEN", "Agent scope does not match");
  }
  const directory = join(resolve(input.root), input.attempt);
  await mkdir(resolve(input.root), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 }); // Exclusive: an earlier attempt is never replaced.
  const manifest = {
    schemaVersion: 1,
    pluginVersion: PERPL_PLUGIN_VERSION,
    status: "started" as "started" | "complete" | "incomplete",
    scope: input.scope,
    agentVersion: agent.version,
    configuration: agent.config,
    startedAt: Date.now(),
    finishedAt: null as number | null,
    files: [] as {
      name: string;
      sha256: string;
      kind: "original" | "normalized";
      url?: string;
      receivedAt?: number;
    }[],
    failure: null as string | null,
  };
  const persist = async () => {
    await writeFile(join(directory, "manifest.tmp"), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await rename(join(directory, "manifest.tmp"), join(directory, "manifest.json"));
  };
  await persist();
  let rawCount = 0;
  const save = async (name: string, result: unknown) => {
    const text = JSON.stringify(result, null, 2);
    await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
    manifest.files.push({ name, sha256: hash(text), kind: "normalized" });
    await persist();
  };
  const summary: {
    symbol: string;
    network: string;
    tickerFreshness: string;
    bookFreshness: string;
    spread: string | null;
    bids: number;
    asks: number;
    fundingRate: string | null;
    fundingIntervalSeconds: number;
    missingCandles: number;
  }[] = [];
  try {
    const session = await createPerplSession(
      {
        agent: async (scope) => {
          const current = await input.repository.agent(scope);
          if (current.version !== agent.version) {
            throw new PilotError("CONFIG_CHANGED", "Configuration changed");
          }
          return current;
        },
      },
      input.scope,
      input.signal,
      {
        ...input.options,
        onResponse: async (response) => {
          const name = `original-${String(++rawCount).padStart(2, "0")}.json`;
          await writeFile(join(directory, name), response.body, { flag: "wx", mode: 0o600 });
          manifest.files.push({
            name,
            sha256: hash(response.body),
            kind: "original",
            url: response.url,
            receivedAt: response.receivedAt,
          });
          await persist();
        },
      },
    );
    const markets = await session.service.listPerpMarkets();
    await save("markets.json", markets);
    const to = Math.floor((input.options?.now?.() ?? Date.now()) / 3600000) * 3600000;
    for (const market of markets.markets) {
      const snapshot = await session.service.getPerpSnapshot({ symbol: market.symbol });
      await save(`${market.symbol}-snapshot.json`, snapshot);
      const book = await session.service.getPerpOrderBook({ symbol: market.symbol });
      await save(`${market.symbol}-book.json`, book);
      const candles = await session.service.getPerpCandles({
        symbol: market.symbol,
        resolution: 3600,
        from: to - 24 * 3600000,
        to,
      });
      await save(`${market.symbol}-candles.json`, candles);
      summary.push(row(snapshot, book, candles.missingOpenTimes.length));
    }
    manifest.status = "complete";
  } catch (error) {
    manifest.status = "incomplete";
    manifest.failure = error instanceof PilotError ? error.code : "PERPL_CAPTURE_FAILED";
  }
  manifest.finishedAt = Date.now();
  await save("summary.json", {
    status: manifest.status,
    markets: summary,
    failure: manifest.failure,
  });
  await persist();
  return { directory, status: manifest.status, markets: summary, failure: manifest.failure };
}
function row(snapshot: PerpSnapshot, book: PerpOrderBook, missingCandles: number) {
  const units = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return (
      BigInt(whole!) * 10n ** BigInt(book.market.priceDecimals) +
      BigInt(fraction.padEnd(book.market.priceDecimals, "0") || "0")
    );
  };
  const spreadRaw =
    book.asks[0] && book.bids[0] ? units(book.asks[0].price) - units(book.bids[0].price) : null;
  const format = (value: bigint) => {
    const decimals = book.market.priceDecimals;
    const s = value.toString().padStart(decimals + 1, "0");
    return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
  };
  return {
    symbol: book.market.symbol,
    network: book.provenance.network,
    tickerFreshness: snapshot.ticker.freshness,
    bookFreshness: book.freshness,
    spread: spreadRaw === null ? null : format(spreadRaw),
    bids: book.bids.length,
    asks: book.asks.length,
    fundingRate: snapshot.funding?.rate ?? null,
    fundingIntervalSeconds: book.market.fundingIntervalSeconds,
    missingCandles,
  };
}

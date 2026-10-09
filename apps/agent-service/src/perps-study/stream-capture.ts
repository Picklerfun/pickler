import { appendFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PilotError } from "@pickler/core";
import type { PerplStreamEvent } from "@pickler/infrastructure";

export const PUBLIC_CAPTURE_LIMIT = 32 * 1024 * 1024;
/** Bounded validated public evidence; callbacks never wait for filesystem work. */
export async function createStreamCapture(
  output: string,
  limit = PUBLIC_CAPTURE_LIMIT,
  marketIds?: readonly number[],
) {
  const path = join(output, "events.jsonl");
  await writeFile(path, "", { flag: "wx", mode: 0o600 });
  const digest = createHash("sha256");
  let tail = Promise.resolve();
  let failure: unknown;
  let bytes = 0;
  let truncated = false;
  let dropped = 0;
  let messages = 0;
  let connections = 0;
  let disconnects = 0;
  let closed = false;
  const errors: {
    code: string;
    receivedAt: number;
    generation: number | null;
    limit?: PerplStreamEvent["limit"];
  }[] = [];
  const components = new Map<
    string,
    {
      marketId: number;
      component: string;
      updates: number;
      repeatedDates: number;
      firstReceivedAt: number;
      lastReceivedAt: number;
      timestamp: number;
      block: number;
    }
  >();
  const subscriptions = new Map<number, number>();
  return {
    record(event: PerplStreamEvent) {
      if (event.kind === "connected") {
        connections++;
        subscriptions.clear();
      }
      if (event.kind === "disconnected") {
        disconnects++;
      }
      if (event.kind === "closed") {
        closed = true;
      }
      if (event.kind === "error" && errors.length < 100) {
        errors.push({
          code: event.code ?? "PERPL_STREAM_MESSAGE",
          receivedAt: event.receivedAt,
          generation: event.generation ?? null,
          ...(event.limit ? { limit: { ...event.limit } } : {}),
        });
      }
      if (event.kind === "message") {
        messages++;
        const msg = event.publicMessage as {
          mt: number;
          sid?: number;
          at?: { t: number; b: number };
          d?: Record<string, { at: { t: number; b: number } }>;
          subs?: { sid: number; stream: string }[];
        };
        for (const sub of msg.subs ?? []) {
          const id = /^order-book@(\d+)$/.exec(sub.stream);
          if (id) {
            subscriptions.set(sub.sid, Number(id[1]));
          }
        }
        const add = (id: number, component: string, at: { t: number; b: number }) => {
          if (marketIds && !marketIds.includes(id)) {
            return;
          }
          const key = `${id}:${component}`;
          const old = components.get(key);
          components.set(key, {
            marketId: id,
            component,
            updates: (old?.updates ?? 0) + 1,
            repeatedDates: (old?.repeatedDates ?? 0) + (old?.timestamp === at.t ? 1 : 0),
            firstReceivedAt: old?.firstReceivedAt ?? event.receivedAt,
            lastReceivedAt: event.receivedAt,
            timestamp: at.t,
            block: at.b,
          });
        };
        if (msg.mt === 9) {
          for (const [id, state] of Object.entries(msg.d ?? {})) {
            add(Number(id), "ticker", state.at);
          }
        }
        if (msg.mt === 15 || msg.mt === 16) {
          const id = subscriptions.get(msg.sid!);
          if (id !== undefined && msg.at) {
            add(id, "book", msg.at);
          }
        }
      }
      const line = JSON.stringify(event) + "\n";
      const size = Buffer.byteLength(line);
      // Stop at the first overflow, preserving a contiguous prefix for offline replay.
      if (truncated || bytes + size > limit) {
        truncated = true;
        dropped++;
        return;
      }
      bytes += size;
      digest.update(line);
      tail = tail
        .then(() => appendFile(path, line))
        .catch((error) => {
          failure ??= error;
        });
    },
    summary() {
      return {
        file: "events.jsonl",
        bytes,
        limitBytes: limit,
        truncated,
        droppedEvents: dropped,
        hash: digest.copy().digest("hex"),
        messages,
        connections,
        disconnects,
        socketClosed: closed,
        errors: errors.map((error) => ({
          ...error,
          ...(error.limit ? { limit: { ...error.limit } } : {}),
        })),
        components: [...components.values()].map((value) => ({ ...value })),
      };
    },
    async flush() {
      await tail;
      if (failure) {
        throw new PilotError(
          "PUBLIC_CAPTURE_PERSISTENCE_FAILED",
          "Public capture could not be persisted",
        );
      }
    },
  };
}

export const publicCsvCell = (value: unknown) => {
  const text = value == null ? "NOT_VERIFIABLE" : String(value);
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
};

export function publicMarketCsv(cycles: readonly { slot: number; markets: unknown[] }[]) {
  const rows = cycles.flatMap((cycle) =>
    cycle.markets.map((market) => ({ slot: cycle.slot, ...(market as Record<string, unknown>) })),
  );
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    [
      headers.map(publicCsvCell).join(","),
      ...rows.map((row) =>
        headers.map((key) => publicCsvCell(row[key as keyof typeof row])).join(","),
      ),
    ].join("\n") + "\n"
  );
}

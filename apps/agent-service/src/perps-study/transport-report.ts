import { z } from "zod";
import { choosePerplTransport } from "@pickler/trading/perps";
import { PilotError } from "@pickler/core";
import { readFile } from "node:fs/promises";
/** Offline analysis of bounded, validated public captures. Loads no providers or environment. */
export async function summarizePerplCapture(path: string) {
  const text = await readFile(path, "utf8");
  const rows = new Map<
    string,
    {
      transport: string;
      component: string;
      marketId: string;
      messages: number;
      repeated: number;
      regressions: number;
      firstReceivedAt: number;
      lastReceivedAt: number;
      lastTimestamp: number | null;
      lastBlock: number | null;
      gapsMs: number[];
    }
  >();
  const add = (
    transport: string,
    component: string,
    marketId: string,
    at: { t?: number; b?: number },
    receivedAt: number,
  ) => {
    const key = `${transport}:${component}:${marketId}`;
    const row = rows.get(key) ?? {
      transport,
      component,
      marketId,
      messages: 0,
      repeated: 0,
      regressions: 0,
      firstReceivedAt: receivedAt,
      lastReceivedAt: receivedAt,
      lastTimestamp: null,
      lastBlock: null,
      gapsMs: [],
    };
    if (row.messages) {
      if (at.t === row.lastTimestamp) {
        row.repeated++;
      }
      if (at.t !== undefined && row.lastTimestamp !== null && at.t < row.lastTimestamp) {
        row.regressions++;
      }
      row.gapsMs.push(receivedAt - row.lastReceivedAt);
    }
    row.messages++;
    row.lastReceivedAt = receivedAt;
    row.lastTimestamp = at.t ?? null;
    row.lastBlock = at.b ?? null;
    rows.set(key, row);
  };
  let heartbeatMessages = 0;
  for (const line of text.split("\n")) {
    if (!line) {
      continue;
    }
    const entry = JSON.parse(line);
    const message =
      entry.kind === "message"
        ? entry.publicMessage
        : entry.kind === "rest-response"
          ? JSON.parse(entry.body)
          : null;
    if (!message) {
      continue;
    }
    const transport = entry.kind === "message" ? "websocket" : "rest";
    if (message.mt === 100) {
      heartbeatMessages++;
    }
    if (message.mt === 9) {
      for (const [id, state] of Object.entries(message.d) as Array<
        [string, { at: { t?: number; b?: number } }]
      >) {
        if (state) {
          add(transport, "ticker", id, state.at, entry.receivedAt);
        }
      }
    }
    if (message.mt === 15 || message.mt === 16) {
      const market =
        transport === "rest"
          ? String(entry.url.match(/market-data\/(\d+)\/book/)?.[1] ?? "unknown")
          : `sid:${message.sid}`;
      add(transport, "book", market, message.at, entry.receivedAt);
    }
  }
  return {
    heartbeatMessages,
    components: [...rows.values()].map((row) => ({
      ...row,
      gapsMs: undefined,
      averageGapMs: row.gapsMs.length
        ? row.gapsMs.reduce((a, b) => a + b, 0) / row.gapsMs.length
        : null,
      maxGapMs: row.gapsMs.length ? Math.max(...row.gapsMs) : null,
    })),
  };
}

export async function readPerplTransportChoice(path: string, configHash?: string) {
  const choice = z
    .object({
      version: z.literal(1),
      policy: z.enum(["rest-paced-20s-v1", "stream-20s-v1"]),
      transport: z.enum(["rest", "websocket"]),
      restValid: z.number().int().min(0).max(10),
      websocketValid: z.number().int().min(0).max(10),
      reconstructionErrors: z.number().int().nonnegative(),
      ownershipErrors: z.number().int().nonnegative(),
      configHash: z.string(),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      diagnosticCompleted: z.literal(true),
    })
    .parse(JSON.parse(await readFile(path, "utf8")));
  const expected = choosePerplTransport({ ...choice, opportunities: 10 });
  if (
    expected.policy !== choice.policy ||
    expected.transport !== choice.transport ||
    (configHash && configHash !== choice.configHash)
  ) {
    throw new PilotError(
      "CONFIG_CHANGED",
      "Frozen transport choice does not match measurements/configuration",
    );
  }
  return choice;
}

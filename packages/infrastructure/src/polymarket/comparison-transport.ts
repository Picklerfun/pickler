import { PilotError, type QuantPlugin } from "@pickler/core";
export interface PublicRequestDiagnostic {
  id: string;
  provider: "polymarket" | "coinbase" | "polygon";
  operation: "metadata" | "opening" | "book" | "conditions" | "candles" | "ticker" | "resolution";
  status: number | null;
  startedAt: number;
  durationMs: number;
  code: string | null;
  cooldownUntil?: number;
}
/** One shared gate per provider, including body consumption; no request is retried. */
export function comparisonTransport(options: {
  guard(plugin: QuantPlugin): Promise<void>;
  report(record: PublicRequestDiagnostic): Promise<void>;
  fetcher?: typeof fetch;
  now?: () => number;
  wait?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}): typeof fetch {
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(new PilotError("PUBLIC_REQUEST_CANCELLED", "Cancelled"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", stop);
          resolve();
        }, ms);
        if (signal?.aborted) {
          stop();
        } else {
          signal?.addEventListener("abort", stop, { once: true });
        }
      }));
  const gates = new Map<string, { tail: Promise<void>; next: number; cooldown: number }>();
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? String(input) : input.url,
    );
    let provider: PublicRequestDiagnostic["provider"],
      operation: PublicRequestDiagnostic["operation"];
    if (url.hostname === "api.exchange.coinbase.com") {
      provider = "coinbase";
      operation = url.pathname.endsWith("/candles") ? "candles" : "ticker";
    } else if (
      ["gamma-api.polymarket.com", "clob.polymarket.com", "polymarket.com"].includes(url.hostname)
    ) {
      provider = "polymarket";
      operation = url.pathname.includes("crypto-price")
        ? "opening"
        : url.pathname === "/book"
          ? "book"
          : "metadata";
    } else if (url.hostname === "polygon-bor-rpc.publicnode.com") {
      provider = "polygon";
      operation = "resolution";
    } else {
      throw new PilotError("PUBLIC_ENDPOINT_NOT_ALLOWED", "Unknown endpoint");
    }
    const gate = gates.get(provider) ?? { tail: Promise.resolve(), next: 0, cooldown: 0 };
    gates.set(provider, gate);
    const previous = gate.tail;
    let release!: () => void;
    gate.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const plugin = provider === "coinbase" ? "coinbase" : "polymarket";
    let record: PublicRequestDiagnostic | undefined;
    try {
      await options.guard(plugin);
      init?.signal?.throwIfAborted();
      if (gate.cooldown > now()) {
        throw new PilotError("PROVIDER_COOLDOWN", "Provider cooldown");
      }
      // Timers may wake early; the clock, not timer completion, admits the request.
      while (gate.next > now()) {
        await wait(gate.next - now(), init?.signal);
      }
      await options.guard(plugin);
      init?.signal?.throwIfAborted();
      const startedAt = now();
      gate.next = startedAt + 500;
      record = {
        id: crypto.randomUUID(),
        provider,
        operation,
        status: null,
        startedAt,
        durationMs: 0,
        code: null,
      };
      const response = await (options.fetcher ?? fetch)(input, init);
      record.status = response.status;
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const delay =
          header === null
            ? 60000
            : /^\d+(\.\d+)?$/.test(header)
              ? Number(header) * 1000
              : Date.parse(header) - now();
        gate.cooldown = now() + (Number.isFinite(delay) && delay >= 0 ? delay : 60000);
        record.cooldownUntil = gate.cooldown;
      }
      record.code = response.ok ? null : `PROVIDER_HTTP_${response.status}`;
      // Bound and consume under the gate. Error bodies are discarded, never persisted.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          size += chunk.value.length;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new PilotError("PUBLIC_RESPONSE_TOO_LARGE", "Response too large");
          }
          if (response.ok) {
            chunks.push(chunk.value);
          }
        }
      }
      const body = new Uint8Array(response.ok ? size : 0);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      if (record) {
        record.code = error instanceof PilotError ? error.code : "PUBLIC_TRANSPORT_FAILED";
      }
      throw error;
    } finally {
      try {
        if (record) {
          record.durationMs = Math.max(0, now() - record.startedAt);
          await options.report(record);
        }
      } finally {
        release();
      }
    }
  };
}

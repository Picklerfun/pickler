import { PilotError } from "@pickler/core";
import type { PerplLiveDocument, PerplLiveOrderSpec } from "@pickler/trading/perpl-live";
import { perplBase64, perplBytes, perplHex, type createPerplKeyVault } from "./key-vault.js";

export const PERPL_TESTNET_API = "https://testnet.perpl.xyz/api";
export type PerplVault = ReturnType<typeof createPerplKeyVault>;
export function perplKeyBinding(
  document: Pick<PerplLiveDocument, "productAgentId" | "address" | "publicKey">,
  purpose: "private" | "token",
) {
  return `perpl-live:1:10143:${document.productAgentId}:${document.address}:${document.publicKey}:${purpose}`;
}
export function createPerplTradingHttp(vault: PerplVault, transport: typeof fetch = fetch) {
  const encoder = new TextEncoder();
  async function request(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      document?: PerplLiveDocument;
      origin?: string;
      guard?: () => Promise<void>;
    } = {},
  ) {
    if (
      !/^\/v1\/(pub\/context|trading\/(wallet|orders|positions|order-history|position-history|fills)(\?[^#]*)?|api-key\/(payload|enroll))$/.test(
        path,
      )
    ) {
      throw new PilotError("PERPL_INVALID_PATH", "Unsupported Perpl operation");
    }
    const method = options.method ?? "GET";
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.origin) {
      headers.Origin = options.origin;
    }
    const d = options.document;
    if (d) {
      if (!d.encryptedKey || !d.encryptedToken) {
        throw new PilotError("PERPL_SETUP_REQUIRED", "Perpl trading credential unavailable");
      }
      const privateBytes = perplBytes(
        await vault.open(d.encryptedKey, perplKeyBinding(d, "private")),
      );
      try {
        const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, "Ed25519", false, [
          "sign",
        ]);
        const timestamp = String(Date.now());
        const nonce = perplBase64(crypto.getRandomValues(new Uint8Array(16)));
        const bodyHash = perplHex(
          new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body))),
        );
        const canonical = ["10143", method, path, timestamp, nonce, bodyHash].join("\n");
        const signature = new Uint8Array(
          await crypto.subtle.sign("Ed25519", privateKey, encoder.encode(canonical)),
        );
        headers["X-API-Key"] = await vault.open(d.encryptedToken, perplKeyBinding(d, "token"));
        headers["X-API-Timestamp"] = timestamp;
        headers["X-API-Nonce"] = nonce;
        headers["X-API-Signature"] = perplBase64(signature);
      } finally {
        privateBytes.fill(0);
      }
    }
    await options.guard?.();
    try {
      const response = await transport(PERPL_TESTNET_API + path, {
        method,
        headers,
        ...(body ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PilotError(`PERPL_HTTP_${response.status}`, "Perpl request was refused");
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error();
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) {
            break;
          }
          size += part.value.length;
          if (size > 1_048_576) {
            throw new PilotError("PERPL_RESPONSE_LIMIT", "Perpl response is too large");
          }
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
      throw error instanceof PilotError
        ? error
        : new PilotError("PERPL_TRANSPORT_UNKNOWN", "Perpl did not return a verified answer");
    }
  }
  return {
    request,
    async submit(
      document: PerplLiveDocument,
      order: PerplLiveOrderSpec,
      guard: () => Promise<void>,
    ) {
      const raw = (await request("/v1/trading/orders", {
        method: "POST",
        body: { d: [order] },
        document,
        guard,
      })) as { status?: { code?: unknown }; statuses?: { code?: unknown }[] };
      if (
        raw.status?.code !== 0 ||
        raw.statuses?.length !== 1 ||
        typeof raw.statuses[0]?.code !== "number"
      ) {
        throw new PilotError(
          "PERPL_SUBMISSION_UNKNOWN",
          "Perpl did not return this order's acknowledgement",
        );
      }
      return raw.statuses[0].code === 0 ? ("accepted" as const) : ("rejected" as const);
    },
  };
}

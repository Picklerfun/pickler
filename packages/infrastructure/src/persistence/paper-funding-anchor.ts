import { networkByChainId } from "@pickler/chain";
import { PilotError } from "@pickler/core";

export interface PaperFundingAnchor {
  number: number;
  hash: string;
  timestamp: number;
}
interface Options {
  chainId: number;
  rpcUrl?: string;
  fetch?: typeof fetch;
  beforeRpc?: (count: number) => void | Promise<void>;
  signal?: AbortSignal;
}
const MAX_BYTES = 1024 * 1024;
const DEADLINE_MS = 10_000;
const unavailable = () => new PilotError("FUNDING_PENDING", "Confirmed funding anchor unavailable");
function integer(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw unavailable();
  }
  const result = BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw unavailable();
  }
  return Number(result);
}
/** Trusted RPC only. Never substitutes latest/safe for finalized or follows redirects. */
export function createPaperFundingAnchor(options: Options) {
  const network = networkByChainId(options.chainId);
  const rpcUrl = options.rpcUrl ?? network?.publicRpcUrls[0];
  if (!network || !rpcUrl) {
    throw unavailable();
  }
  const fetcher = options.fetch ?? fetch;
  let requestId = 0;
  async function rpc(method: string, params: unknown[]) {
    options.signal?.throwIfAborted();
    await options.beforeRpc?.(1);
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const id = ++requestId;
    let cancel: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          cancel?.();
          reject(unavailable());
        }, DEADLINE_MS);
      });
      return await Promise.race([
        deadline,
        (async () => {
          const response = await fetcher(rpcUrl!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
            redirect: "error",
            signal: controller.signal,
          });
          if (
            !response.ok ||
            Number(response.headers.get("content-length") ?? 0) > MAX_BYTES ||
            !response.body
          ) {
            void response.body?.cancel().catch(() => {});
            throw unavailable();
          }
          const reader = response.body.getReader();
          cancel = () => {
            void reader.cancel().catch(() => {});
          };
          controller.signal.addEventListener("abort", cancel, { once: true });
          try {
            const decoder = new TextDecoder("utf-8", { fatal: true });
            let bytes = 0;
            let text = "";
            while (true) {
              controller.signal.throwIfAborted();
              const chunk = await reader.read();
              controller.signal.throwIfAborted();
              if (chunk.done) {
                break;
              }
              bytes += chunk.value.byteLength;
              if (bytes > MAX_BYTES) {
                cancel();
                throw unavailable();
              }
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
            const value = JSON.parse(text);
            if (
              !value ||
              value.jsonrpc !== "2.0" ||
              value.id !== id ||
              value.error ||
              !("result" in value)
            ) {
              throw unavailable();
            }
            return value.result as unknown;
          } finally {
            controller.signal.removeEventListener("abort", cancel);
            reader.releaseLock();
          }
        })(),
      ]);
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  return async (expected?: PaperFundingAnchor): Promise<PaperFundingAnchor> => {
    if (
      expected &&
      (!Number.isSafeInteger(expected.number) ||
        expected.number < 0 ||
        !/^0x[a-f0-9]{64}$/i.test(expected.hash) ||
        !Number.isSafeInteger(expected.timestamp) ||
        expected.timestamp < 0)
    ) {
      throw unavailable();
    }
    if (integer(await rpc("eth_chainId", [])) !== options.chainId) {
      throw unavailable();
    }
    const value = await rpc("eth_getBlockByNumber", [
      expected ? `0x${expected.number.toString(16)}` : "finalized",
      false,
    ]);
    if (!value || typeof value !== "object") {
      throw unavailable();
    }
    const block = value as Record<string, unknown>;
    if (typeof block.hash !== "string" || !/^0x[a-f0-9]{64}$/i.test(block.hash)) {
      throw unavailable();
    }
    const anchor = {
      number: integer(block.number),
      hash: block.hash.toLowerCase(),
      timestamp: integer(block.timestamp) * 1000,
    };
    if (
      !Number.isSafeInteger(anchor.timestamp) ||
      (expected &&
        (expected.number !== anchor.number ||
          expected.hash.toLowerCase() !== anchor.hash ||
          expected.timestamp !== anchor.timestamp))
    ) {
      throw new PilotError("FUNDING_PENDING", "Confirmed funding anchor changed");
    }
    return anchor;
  };
}

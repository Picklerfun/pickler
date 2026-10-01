import { networkFailure, type NetworkFailure } from "./network-diagnostics.js";
import { abortable } from "./transport.js";
export interface ConnectivityControl {
  target: "cloudflare-public";
  at: number;
  durationMs: number;
  status: number | null;
  reachable: boolean;
  failure: NetworkFailure | null;
}
/** Diagnostic only. Fixed public host, one request, no redirect, body, retry or market fallback. */
export async function checkPublicConnectivity(input: {
  signal: AbortSignal;
  guard: () => Promise<void>;
  transport?: typeof fetch;
}): Promise<ConnectivityControl> {
  await input.guard();
  input.signal.throwIfAborted();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(3000)]);
  const at = Date.now();
  let status: number | null = null;
  let failure: NetworkFailure | null = null;
  try {
    const response = await abortable(
      (input.transport ?? fetch)("https://www.cloudflare.com/cdn-cgi/trace", {
        method: "GET",
        redirect: "manual",
        signal,
      }),
      signal,
    );
    status = response.status;
    void response.body?.cancel().catch(() => {});
  } catch (error) {
    input.signal.throwIfAborted();
    failure = networkFailure(error, signal.aborted ? "timeout" : "error");
  }
  await input.guard();
  input.signal.throwIfAborted();
  return {
    target: "cloudflare-public",
    at,
    durationMs: Date.now() - at,
    status,
    reachable: status !== null,
    failure,
  };
}

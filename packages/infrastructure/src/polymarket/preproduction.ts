/** Public diagnostics only. This environment is NOT a verified testnet. */
export const polymarketPreproduction = Object.freeze({
  name: "international-preproduction",
  configuredChainId: 137,
  testFundsVerified: false,
  tradingEnabled: false,
  clob: "https://clob-preprod-int-v2.polymarket.com",
  gamma: "https://gamma-api-preprod-int.polymarket.com",
  source:
    "https://github.com/Polymarket/ts-sdk/blob/f72f9b32841bc056b512a14cfc3516c31a3b0d74/packages/client/src/environments.ts",
});

type Probe = { service: "clob" | "gamma"; path: string; valid: (value: unknown) => boolean };

const probes: Probe[] = [
  {
    service: "clob",
    path: "/time",
    valid: (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
  },
  {
    service: "gamma",
    path: "/markets?limit=1&active=true&closed=false",
    valid: (value) =>
      Array.isArray(value) &&
      value.every(
        (market: unknown) =>
          typeof market === "object" &&
          market !== null &&
          "id" in market &&
          (typeof market.id === "string" || typeof market.id === "number"),
      ),
  },
];

/** Never accepts credentials, host overrides, order payloads or an SDK signer. */
export async function probePolymarketPreproduction(
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const results = [];
  for (const probe of probes) {
    const started = Date.now();
    let status: number | null = null;
    let outcome = "NETWORK_ERROR";
    let marketCount: number | null = null;
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await transport(polymarketPreproduction[probe.service] + probe.path, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Accept: "application/json" },
      });
      status = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        outcome = "HTTP_ERROR";
      } else {
        const value: unknown = await response.json();
        outcome = probe.valid(value) ? "OK" : "INVALID_RESPONSE";
        if (outcome === "OK" && probe.service === "gamma" && Array.isArray(value)) {
          marketCount = value.length;
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        outcome = "CANCELLED";
      } else if (error instanceof Error && error.name === "TimeoutError") {
        outcome = "TIMEOUT";
      } else if (error instanceof SyntaxError) {
        outcome = "INVALID_RESPONSE";
      }
    }
    results.push({
      service: probe.service,
      status,
      outcome,
      marketCount,
      durationMs: Date.now() - started,
    });
    if (signal?.aborted) {
      break;
    }
  }
  return {
    environment: polymarketPreproduction,
    checkedAt: new Date().toISOString(),
    publicReadAccess:
      results.length === probes.length && results.every((result) => result.outcome === "OK"),
    orderAcceptanceVerified: false,
    results,
  };
}

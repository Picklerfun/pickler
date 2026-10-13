import type { PerplLiveStateDto } from "@pickler/api-schema";

/** Explicit development fixtures. No explorer hashes, credentials or provider requests. */
export function perplExecutionFixture(mode: "ready" | "active" | "closed"): PerplLiveStateDto {
  const time = "2026-10-02T14:30:00.000Z";
  const sessionId = "00000000-0000-4000-8000-000000000101";
  const opening = {
    id: "00000000-0000-4000-8000-000000000102",
    sessionId,
    requestId: 1,
    orderId: 101,
    symbol: "BTC",
    action: "open_long" as const,
    status: "filled" as const,
    createdAt: time,
    filledSize: "0.00005000",
    fillPrice: "96900.0",
    feeAusd: "0.001672",
    txHashes: [],
    error: null,
  };
  return {
    available: true,
    admissionsEnabled: true,
    network: "testnet",
    address: "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07",
    accountId: 7,
    setupRequired: false,
    keyExpiresAt: "2027-01-01T00:00:00.000Z",
    setup: [],
    session:
      mode === "ready"
        ? null
        : {
            id: sessionId,
            status: mode === "active" ? "active" : "completed",
            settings: {
              symbol: "BTC",
              marginAusd: "5.000000",
              leverage: 1,
              cycles: 1,
              holdSeconds: 60,
            },
            completedCycles: mode === "closed" ? 1 : 0,
            openedAt: time,
            createdAt: time,
            error: null,
          },
    balanceAusd: "100.000000",
    observedAt: time,
    positions:
      mode === "ready"
        ? []
        : [
            {
              id: "8",
              symbol: "BTC",
              side: "long",
              closed: mode === "closed",
              size: "0.00005000",
              entryPrice: "96900.0",
              markPrice: "97420.0",
              exitPrice: mode === "closed" ? "97420.0" : null,
              collateralAusd: "4.845000",
              leverage: 1,
              unrealizedPnlAusd: mode === "active" ? "0.026000" : null,
              realizedPnlAusd: mode === "closed" ? "0.026000" : null,
              fundingAusd: null,
              feeAusd: "0.001672",
            },
          ],
    orders:
      mode === "ready"
        ? []
        : mode === "active"
          ? [opening]
          : [
              {
                ...opening,
                id: "00000000-0000-4000-8000-000000000103",
                requestId: 2,
                orderId: 102,
                action: "close_long",
                fillPrice: "97420.0",
              },
              opening,
            ],
  };
}

import type { PerplLiveStateDto } from "@pickler/api-schema";

/** Explicit development fixtures. No explorer hashes, credentials or provider requests. */
export function perplExecutionFixture(
  mode: "setup" | "ready" | "active" | "closed",
): PerplLiveStateDto {
  const idle = mode === "setup";
  const time = "2026-10-02T14:30:00.000Z";
  const sessionId = "00000000-0000-4000-8000-000000000101";
  const opening = {
    id: "00000000-0000-4000-8000-000000000102",
    sessionId,
    requestId: 1,
    orderId: 101,
    symbol: "NEAR",
    action: "open_long" as const,
    status: "filled" as const,
    createdAt: time,
    filledSize: "0.01000000",
    fillPrice: "3.60",
    feeAusd: "0.000018",
    txHashes: [],
    error: null,
  };
  return {
    available: true,
    admissionsEnabled: true,
    setupEnabled: false,
    network: "testnet",
    address: "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07",
    accountId: mode === "setup" ? null : 7,
    setupRequired: mode === "setup",
    requirements: {
      minimumAccountAusd: "100.000000",
      minimumDepositAusd: "10.000000",
      maximumCollateralAusd: "100.000000",
    },
    keyExpiresAt: mode === "setup" ? null : "2027-01-01T00:00:00.000Z",
    setup: [],
    connection: "key_wallet",
    session:
      idle || mode === "ready"
        ? null
        : {
            id: sessionId,
            status: mode === "active" ? "active" : "completed",
            settings: {
              symbol: "NEAR",
              marginAusd: "0.060000",
              leverage: 1,
              cycles: 1,
              holdSeconds: 30,
            },
            completedCycles: mode === "closed" ? 1 : 0,
            openedAt: time,
            createdAt: time,
            error: null,
          },
    balanceAusd: "10.000000",
    observedAt: time,
    positions: idle
      ? []
      : [
          {
            id: "8",
            managedBySession: mode === "active",
            symbol: "NEAR",
            side: "long",
            closed: mode !== "active",
            size: "0.01000000",
            entryPrice: "3.60",
            markPrice: "3.61",
            exitPrice: mode === "closed" ? "3.61" : null,
            collateralAusd: "0.036000",
            leverage: 1,
            unrealizedPnlAusd: mode === "active" ? "0.000100" : null,
            realizedPnlAusd: mode === "closed" ? "0.000100" : null,
            fundingAusd: null,
            feeAusd: "0.000018",
          },
          ...["BTC", "ETH", "SOL", "MON", "LIT", "PUMP"].map((symbol, i) => ({
            id: `existing-${i}`,
            managedBySession: false,
            symbol,
            side: "long" as const,
            closed: false,
            size: "0.01",
            entryPrice: null,
            markPrice: null,
            exitPrice: null,
            collateralAusd: "0.10",
            leverage: 1,
            unrealizedPnlAusd: null,
            realizedPnlAusd: null,
            fundingAusd: null,
            feeAusd: "0.000001",
          })),
        ],
    orders: idle
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
              createdAt: "2026-10-02T14:30:30.000Z",
              fillPrice: "3.61",
            },
            opening,
          ],
  };
}

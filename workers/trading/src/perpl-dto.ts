import {
  perplLiveSetupSchema,
  perplLiveStateSchema,
  type PerplLiveSetupDto,
} from "@pickler/api-schema";
import type {
  PerplLiveAuthority,
  PerplLiveDocument,
  PerplLiveSetup,
} from "@pickler/trading/perpl-live";

export function perplDecimal(value: string | number | bigint, decimals = 6) {
  const n = BigInt(value);
  const abs = (n < 0n ? -n : n).toString().padStart(decimals + 1, "0");
  if (!decimals) {
    return n.toString();
  }
  return `${n < 0n ? "-" : ""}${abs.slice(0, -decimals)}.${abs.slice(-decimals)}`;
}
export function perplSetupDto(setup: PerplLiveSetup): PerplLiveSetupDto {
  return perplLiveSetupSchema.parse({
    id: setup.id,
    kind: setup.kind,
    status: setup.status,
    collateralAusd: perplDecimal(setup.amountMicros),
    activity: setup.status === "awaiting_signature" ? setup.activity : null,
    txHash: setup.txHash,
    error: setup.error,
  });
}
export function perplStateDto(state: {
  authority: PerplLiveAuthority;
  document: PerplLiveDocument | null;
  available: boolean;
  admissionsEnabled: boolean;
  setupAdmissionsEnabled?: boolean;
  requirements?: {
    minimumAccountMicros: string;
    minimumDepositMicros: string;
    maximumCollateralMicros: string;
  } | null;
}) {
  const d = state.document;
  const snap = d?.snapshot;
  const session = d?.sessions.at(-1);
  const settings = session
    ? {
        symbol: session.settings.symbol,
        marginAusd: perplDecimal(session.settings.marginMicros),
        leverage: session.settings.leverage,
        cycles: session.settings.cycles,
        holdSeconds: session.settings.holdSeconds,
      }
    : null;
  return perplLiveStateSchema.parse({
    available: state.available,
    admissionsEnabled: state.admissionsEnabled,
    setupEnabled: state.setupAdmissionsEnabled,
    network: "testnet",
    address: state.authority.address,
    accountId: d?.accountId ?? null,
    setupRequired: !d?.encryptedToken || !d.keyExpiresAt || d.keyExpiresAt <= Date.now(),
    requirements: state.requirements
      ? {
          minimumAccountAusd: perplDecimal(state.requirements.minimumAccountMicros),
          minimumDepositAusd: perplDecimal(state.requirements.minimumDepositMicros),
          maximumCollateralAusd: perplDecimal(state.requirements.maximumCollateralMicros),
        }
      : null,
    keyExpiresAt: d?.keyExpiresAt ? new Date(d.keyExpiresAt).toISOString() : null,
    setup: d?.setup.slice(-100).map(perplSetupDto) ?? [],
    session: session
      ? {
          id: session.id,
          status: session.status,
          settings,
          completedCycles: session.completedCycles,
          openedAt: session.openedAt ? new Date(session.openedAt).toISOString() : null,
          createdAt: new Date(session.createdAt).toISOString(),
          error: session.error,
        }
      : null,
    balanceAusd: snap ? perplDecimal(snap.balanceMicros) : null,
    observedAt: snap ? new Date(snap.at).toISOString() : null,
    positions:
      snap?.positions.slice(-100).map((p) => {
        const current = snap.markets.find((market) => market.id === p.marketId);
        const m = current ?? d?.orders.find((o) => o.request.mkt === p.marketId)?.market;
        let unrealizedPnlAusd: string | null = null;
        if (current && m && !p.closed) {
          const units =
            (BigInt(current.mark - p.entryPrice) * BigInt(p.size) * 1_000_000n) /
            10n ** BigInt(m.priceDecimals + m.sizeDecimals);
          unrealizedPnlAusd = perplDecimal(p.side === "long" ? units : -units);
        }
        return {
          id: String(p.id),
          symbol: m?.symbol ?? `Market ${p.marketId}`,
          side: p.side,
          closed: p.closed,
          size: m ? perplDecimal(p.size, m.sizeDecimals) : null,
          entryPrice: m ? perplDecimal(p.entryPrice, m.priceDecimals) : null,
          markPrice: current ? perplDecimal(current.mark, current.priceDecimals) : null,
          exitPrice: p.exitPrice !== null && m ? perplDecimal(p.exitPrice, m.priceDecimals) : null,
          collateralAusd: perplDecimal(p.collateralMicros),
          leverage: p.leverage / 100,
          unrealizedPnlAusd,
          realizedPnlAusd: p.realizedPnlMicros !== null ? perplDecimal(p.realizedPnlMicros) : null,
          fundingAusd: p.fundingMicros !== null ? perplDecimal(p.fundingMicros) : null,
          feeAusd: perplDecimal(p.feeMicros),
        };
      }) ?? [],
    orders:
      d?.orders
        .slice(-100)
        .reverse()
        .map((o) => {
          const market = o.market;
          const action = (["open_long", "open_short", "close_long", "close_short"] as const)[
            o.request.t - 1
          ]!;
          return {
            id: o.id,
            sessionId: o.sessionId,
            requestId: o.request.rq,
            orderId: o.evidence?.orderId ?? null,
            symbol: market?.symbol ?? String(o.request.mkt),
            action,
            status: o.status,
            createdAt: new Date(o.createdAt).toISOString(),
            filledSize: o.evidence
              ? perplDecimal(o.evidence.filledSize, market?.sizeDecimals ?? 0)
              : null,
            fillPrice:
              o.evidence && o.evidence.filledSize > 0
                ? perplDecimal(o.evidence.fillPrice, market?.priceDecimals ?? 0)
                : null,
            feeAusd: o.evidence ? perplDecimal(o.evidence.feeMicros) : null,
            txHashes: o.verifiedTxHashes,
            error: o.error,
          };
        }) ?? [],
  });
}

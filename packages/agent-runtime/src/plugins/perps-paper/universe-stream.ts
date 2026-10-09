import { createHash } from "node:crypto";
import {
  PilotError,
  type Scope,
  type PerpSymbol,
  type AgentRecord,
  type createPerpReadService,
} from "@pickler/core";
import {
  PerplPublicStream,
  abortablePerplRead,
  pausePerplRead,
  type PerplSocket,
  type PerplStreamEvent,
} from "@pickler/infrastructure";
import {
  acquireUniverseStream,
  validateUniverseStream,
  transientPerpsData,
  type AcquisitionDiagnostic,
  type UniverseStreamResult,
  type UniverseStreamBuffer,
} from "@pickler/trading/perps";

type Catalog = readonly { symbol: PerpSymbol; marketId: number }[];
/** Private composition: public socket, scoped REST metadata, and business-owned coherence. */
export function createUniverseStreamReader(options: {
  now(): number;
  signal: AbortSignal;
  check(scope: Scope, signal: AbortSignal, guard?: () => Promise<void>): Promise<AgentRecord>;
  session(
    scope: Scope,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ): Promise<Awaited<ReturnType<ReturnType<typeof createPerpReadService>>>>;
  guard?: () => Promise<void>;
  socket?: (url: string) => PerplSocket;
  onStream?: (event: PerplStreamEvent) => void;
  onBuffer?: (value: UniverseStreamBuffer) => void;
  onAcquisition?: (value: AcquisitionDiagnostic) => void;
}) {
  let stream: PerplPublicStream | undefined;
  let frozenCatalog: string | undefined;
  let active: { scope: Scope; parent: AbortSignal; guard?: () => Promise<void> } | undefined;
  let busy = false;
  const lifetime = new AbortController();
  const parents = new Map<AbortSignal, () => void>();
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  async function guard() {
    options.signal.throwIfAborted();
    lifetime.signal.throwIfAborted();
    if (!active) {
      throw new PilotError("DATA_UNAVAILABLE", "Stream scope is absent");
    }
    active.parent.throwIfAborted();
    await options.guard?.();
    return options.check(active.scope, active.parent, active.guard);
  }
  function link(parent: AbortSignal) {
    parent.throwIfAborted();
    if (!parents.has(parent)) {
      const abort = () => {
        lifetime.abort(parent.reason);
        void stream?.close().catch(() => {});
      };
      parent.addEventListener("abort", abort, { once: true });
      parents.set(parent, abort);
    }
  }
  async function latest(markets: Catalog, signal: AbortSignal) {
    const current = await guard();
    signal.throwIfAborted();
    if (!stream) {
      throw new PilotError("DATA_UNAVAILABLE", "Stream has not been acquired");
    }
    const buffer = await stream.latest(
      markets.map((m) => m.symbol),
      signal,
    );
    await guard();
    signal.throwIfAborted();
    return validateUniverseStream({
      network: current.config.perpl!.network,
      markets,
      buffer,
      now: options.now(),
      hash,
      ...(options.onAcquisition ? { diagnostic: options.onAcquisition } : {}),
    });
  }
  return {
    async read(scope: Scope, markets: Catalog, parent: AbortSignal, owned?: () => Promise<void>) {
      if (busy) {
        throw new PilotError("CONFLICT", "Universe acquisitions cannot overlap");
      }
      busy = true;
      const deadlineAt = options.now() + 20000;
      const timeout = AbortSignal.timeout(20000);
      const signal = AbortSignal.any([parent, options.signal, lifetime.signal, timeout]);
      active = { scope, parent, ...(owned ? { guard: owned } : {}) };
      const key = JSON.stringify([...markets].sort((a, b) => a.marketId - b.marketId));
      const operation = async (): Promise<UniverseStreamResult> => {
        const current = await guard();
        signal.throwIfAborted();
        if (frozenCatalog !== undefined && frozenCatalog !== key) {
          throw new PilotError("CONFIG_CHANGED", "Frozen stream catalog changed");
        }
        if (!stream) {
          const service = await options.session(scope, signal, owned);
          const listed = await service.listPerpMarkets();
          await guard();
          signal.throwIfAborted();
          const selected = markets.map((m) => {
            const info = listed.markets.find(
              (v) => v.symbol === m.symbol && v.marketId === m.marketId,
            );
            if (!info || info.collateral.symbol !== "AUSD") {
              throw new PilotError(
                "PERPL_MARKET_IDENTITY",
                "Frozen stream catalog differs from metadata",
              );
            }
            return structuredClone(info);
          });
          frozenCatalog = key;
          options.onStream?.({
            kind: "catalog",
            receivedAt: options.now(),
            generation: 0,
            publicMessage: { markets: selected },
          });
          stream = new PerplPublicStream({
            markets: selected,
            signal: AbortSignal.any([options.signal, lifetime.signal]),
            guard: async () => {
              await guard();
            },
            now: options.now,
            messageProcessing: "direct-reconstruction",
            ...(options.socket ? { socket: options.socket } : {}),
            ...(options.onStream ? { event: options.onStream } : {}),
          });
        }
        return acquireUniverseStream({
          network: current.config.perpl!.network,
          markets,
          deadlineAt,
          signal,
          now: options.now,
          guard: async () => {
            await guard();
            signal.throwIfAborted();
          },
          read: async () => {
            signal.throwIfAborted();
            if (options.now() >= deadlineAt) {
              throw new PilotError("DATA_UNAVAILABLE", "Stream acquisition deadline exhausted");
            }
            await stream!.connect(signal);
            const buffer = await stream!.latest(
              markets.map((m) => m.symbol),
              signal,
            );
            signal.throwIfAborted();
            if (options.now() < deadlineAt) {
              options.onBuffer?.(structuredClone(buffer));
            }
            return buffer;
          },
          hash,
          wait: pausePerplRead,
          ...(options.onAcquisition ? { diagnostic: options.onAcquisition } : {}),
        });
      };
      try {
        link(parent);
        return await abortablePerplRead(operation(), signal);
      } catch (error) {
        parent.throwIfAborted();
        options.signal.throwIfAborted();
        lifetime.signal.throwIfAborted();
        // A simultaneous deadline must not disguise a proven permission/identity/lease failure.
        if (
          error instanceof PilotError &&
          !transientPerpsData(error) &&
          error.code !== "PERPL_CANCELLED"
        ) {
          lifetime.abort(error);
          await stream?.close().catch(() => {});
          throw error;
        }
        if (timeout.aborted || transientPerpsData(error)) {
          // Do not perform a new ownership lookup or buffer copy beyond the fixed deadline.
          // Per-component evidence remains in the checks; no late data is executable.
          return {
            frames: [],
            excluded: markets.map(({ symbol }) => ({
              symbol,
              code: "DATA_UNAVAILABLE",
              phase: "stream-acquisition",
            })),
          };
        }
        throw error;
      } finally {
        busy = false;
      }
    },
    async latest(scope: Scope, markets: Catalog, parent: AbortSignal, owned?: () => Promise<void>) {
      if (busy) {
        throw new PilotError("CONFLICT", "Universe buffer reads cannot overlap acquisitions");
      }
      const key = JSON.stringify([...markets].sort((a, b) => a.marketId - b.marketId));
      if (frozenCatalog !== key) {
        throw new PilotError(
          "CONFIG_CHANGED",
          "Latest stream catalog differs from its subscription",
        );
      }
      active = { scope, parent, ...(owned ? { guard: owned } : {}) };
      try {
        link(parent);
        return await latest(markets, parent);
      } catch (error) {
        if (
          !(error instanceof PilotError) ||
          !["DATA_UNAVAILABLE", "STALE_MARKET_DATA", "INCONSISTENT_MARKET_DATA"].includes(
            error.code,
          )
        ) {
          lifetime.abort(error);
          await stream?.close().catch(() => {});
        }
        throw error;
      }
    },
    async close() {
      lifetime.abort(new PilotError("DATA_READER_CLOSED", "Universe stream closed"));
      for (const [parent, abort] of parents) {
        parent.removeEventListener("abort", abort);
      }
      parents.clear();
      await stream?.close();
    },
  };
}

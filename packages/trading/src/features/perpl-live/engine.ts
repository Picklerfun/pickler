import {
  PilotError,
  InvalidSignedActivityError,
  SignedActivityRejectedError,
  type SignedActivityRequest,
} from "@pickler/core";
import type {
  PerplLiveDocument,
  PerplLiveExistingKey,
  PerplLiveDriver,
  PerplLiveRepository,
  PerplLiveScope,
  PerplLiveSettings,
  PerplLiveSetup,
  PerplLiveOrderSpec,
} from "./contracts.js";
import {
  assertLiveAuthority,
  assertLiveSettings,
  liveAmount,
  liveOrderSize,
  isPerplSessionPosition,
} from "./policy.js";

const activeStatuses = new Set(["active", "paused", "stopping", "frozen"]);
const unresolved = new Set(["prepared", "dispatching", "unknown", "accepted"]);
export function emptyPerplLiveDocument(address: string, productAgentId: string): PerplLiveDocument {
  return {
    productAgentId,
    version: 1,
    address,
    accountId: null,
    publicKey: null,
    encryptedKey: null,
    encryptedToken: null,
    keyExpiresAt: null,
    nextRequestId: 0,
    setup: [],
    sessions: [],
    orders: [],
    snapshot: null,
    lease: null,
  };
}
export function createPerplLiveService(deps: {
  repository: PerplLiveRepository;
  driver: PerplLiveDriver;
  admissions: boolean;
  setupAdmissions?: boolean;
  randomId: () => string;
}) {
  const repo = deps.repository;
  async function state(scope: PerplLiveScope) {
    const value = await repo.read(scope);
    const requirements = (await deps.driver.requirements?.().catch(() => null)) ?? null;
    return {
      ...value,
      available: true,
      admissionsEnabled: deps.admissions,
      setupAdmissionsEnabled:
        (deps.setupAdmissions ?? deps.admissions) &&
        value.document?.connection?.kind !== "key_wallet",
      requirements,
    };
  }
  function assertCredentialChange(document: PerplLiveDocument, now: number) {
    if (
      document.sessions.some((session) => activeStatuses.has(session.status)) ||
      document.orders.some((order) => unresolved.has(order.status)) ||
      document.setup.some((step) => !["confirmed", "failed"].includes(step.status)) ||
      (document.lease && document.lease.expiresAt > now)
    ) {
      throw new PilotError(
        "PERPL_SESSION_PENDING",
        "Resolve existing account work before changing its key",
      );
    }
  }
  async function connectExistingKey(scope: PerplLiveScope, input: PerplLiveExistingKey) {
    if (!deps.driver.connectExistingKey) {
      throw new PilotError("PERPL_UNAVAILABLE", "Existing Perpl keys are not supported");
    }
    if (
      !/^[\x21-\x7e]{1,2048}$/.test(input.apiKey) ||
      !/^(?:0x)?[a-f\d]{64}$/i.test(input.privateKeyHex)
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "A Perpl API token and 32-byte Ed25519 key are required",
      );
    }
    const original = await repo.transact(scope, (document, authority, now) => {
      assertLiveAuthority(authority, true);
      assertCredentialChange(document, now);
      return { authority, document, validUntil: now + 24 * 60 * 60 * 1000 };
    });
    // Authentication uses reads only. No provider request runs under the repository lock.
    const connected = await deps.driver.connectExistingKey(
      original.authority,
      original.document,
      input,
      original.validUntil,
    );
    await repo.transact(scope, (document, authority, now) => {
      assertLiveAuthority(authority, true);
      assertCredentialChange(document, now);
      if (
        authority.configVersion !== original.authority.configVersion ||
        authority.address !== original.authority.address ||
        document.encryptedKey !== original.document.encryptedKey ||
        document.encryptedToken !== original.document.encryptedToken ||
        original.validUntil <= now
      ) {
        throw new PilotError("CONFLICT", "Account configuration changed while validating the key");
      }
      const address = connected.address ?? original.authority.address;
      if (
        !/^0x[a-f\d]{40}$/.test(address) ||
        (!input.useKeyWallet && address !== authority.address)
      ) {
        throw new PilotError(
          "PERPL_EVIDENCE_MISMATCH",
          "Verified connection wallet does not match",
        );
      }
      if (
        (address !== document.address ||
          (document.accountId !== null && connected.accountId !== document.accountId)) &&
        (document.orders.length || document.sessions.length || document.setup.length)
      ) {
        throw new PilotError(
          "PERPL_ACCOUNT_CHANGED",
          "Existing account history cannot move to another wallet",
        );
      }
      const custodyAddress = authority.custodyAddress ?? authority.address;
      Object.assign(document, connected, { address, keyExpiresAt: original.validUntil });
      if (input.useKeyWallet) {
        document.connection = { kind: "key_wallet", custodyAddress };
      }

      document.nextRequestId = Math.max(document.nextRequestId, connected.snapshot.lastRequestId);
    });
    return state(scope);
  }
  async function prepareSetup(scope: PerplLiveScope, amountMicros: string, key: string) {
    if (!(deps.setupAdmissions ?? deps.admissions)) {
      throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Perpl account preparation is disabled");
    }
    const reserved = await repo.transact(scope, (d, authority, now) => {
      assertLiveAuthority(authority, true);
      if (d.connection?.kind === "key_wallet") {
        throw new PilotError("PERPL_EXTERNAL_WALLET_SETUP", "Fund this connected wallet in Perpl");
      }
      const amount = liveAmount(amountMicros);
      if (amount > BigInt(authority.perDayMicros)) {
        throw new PilotError("PERPL_MARGIN_LIMIT", "Collateral exceeds the agent's daily limit");
      }
      const replay = d.setup.find((s) => s.key === key);
      if (replay) {
        if (replay.amountMicros !== amountMicros) {
          throw new PilotError("CONFLICT", "The request key has different terms");
        }
        return { setup: replay, fresh: false, authority, document: structuredClone(d) };
      }
      for (const step of d.setup) {
        if (
          ["preparing", "awaiting_signature"].includes(step.status) &&
          step.createdAt + 300_000 < now
        ) {
          step.status = "failed";
          step.error = "PERPL_PREPARATION_EXPIRED";
        }
      }
      if (d.setup.some((s) => !["confirmed", "failed"].includes(s.status))) {
        throw new PilotError("PERPL_SETUP_PENDING", "Complete the pending account preparation");
      }
      const setup: PerplLiveSetup = {
        id: deps.randomId(),
        key,
        kind: "approve",
        status: "preparing",
        amountMicros,
        createdAt: now,
        activity: null,
        privatePreparation: null,
        activityId: null,
        txHash: null,
        error: null,
      };
      d.setup.push(setup);
      return { setup, fresh: true, authority, document: structuredClone(d) };
    });
    if (!reserved.fresh) {
      return reserved.setup;
    }
    try {
      const prepared = await deps.driver.prepareSetup(
        reserved.authority,
        reserved.document,
        amountMicros,
      );
      return await repo.transact(scope, (d, authority, now) => {
        const s = d.setup.find((x) => x.id === reserved.setup.id)!;
        if (s.status !== "preparing") {
          throw new PilotError("CONFLICT", "Preparation changed");
        }
        assertLiveAuthority(authority, true);
        if (["create_account", "deposit"].includes(prepared.kind)) {
          const day = new Date(now).toISOString().slice(0, 10);
          const funded = d.setup
            .filter(
              (step) =>
                step.id !== s.id &&
                ["create_account", "deposit"].includes(step.kind) &&
                step.status !== "failed" &&
                new Date(step.createdAt).toISOString().startsWith(day),
            )
            .reduce((sum, step) => sum + BigInt(step.amountMicros), 0n);
          if (funded + liveAmount(amountMicros) > BigInt(authority.perDayMicros)) {
            throw new PilotError("PERPL_DAY_LIMIT", "Daily collateral funding limit reached");
          }
        }
        Object.assign(s, {
          kind: prepared.kind,
          activity: prepared.activity,
          privatePreparation: prepared.privatePreparation,
          status: "awaiting_signature",
        });
        if (prepared.key) {
          d.encryptedToken = null;
          d.publicKey = prepared.key.publicKey;
          d.encryptedKey = prepared.key.encryptedKey;
          d.keyExpiresAt = prepared.key.expiresAt;
        }
        return s;
      });
    } catch (error) {
      await repo.transact(scope, (d) => {
        const s = d.setup.find((x) => x.id === reserved.setup.id)!;
        s.status = "failed";
        s.error = error instanceof PilotError ? error.code : "PERPL_SETUP_UNAVAILABLE";
      });
      throw error instanceof PilotError
        ? error
        : new PilotError("PERPL_SETUP_UNAVAILABLE", "Could not prepare Perpl");
    }
  }
  async function confirmSetup(scope: PerplLiveScope, id: string, signed: SignedActivityRequest) {
    const claim = await repo.transact(scope, (d, authority) => {
      const setup = d.setup.find((s) => s.id === id);
      if (!setup) {
        throw new PilotError("NOT_FOUND", "Preparation not found");
      }
      if (setup.status !== "awaiting_signature") {
        return { fresh: false, setup, authority, document: structuredClone(d) };
      }
      assertLiveAuthority(authority, true);
      if (!(deps.setupAdmissions ?? deps.admissions)) {
        throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Preparation is disabled");
      }
      setup.status = "signing";
      return {
        fresh: true,
        setup: structuredClone(setup),
        authority,
        document: structuredClone(d),
      };
    });
    if (!claim.fresh) {
      return claim.setup;
    }
    const guard = async () => {
      const { authority, document } = await repo.read(scope);
      assertLiveAuthority(authority, true);
      if (document?.setup.find((s) => s.id === id)?.status !== "signing") {
        throw new PilotError("CONFLICT", "Signing claim no longer holds");
      }
    };
    try {
      const result = await deps.driver.confirmSetup(
        claim.authority,
        claim.document,
        claim.setup,
        signed,
        guard,
        async (change) => {
          await repo.transact(scope, (d) => {
            const setup = d.setup.find((s) => s.id === id)!;
            if (setup.status !== "signing") {
              throw new PilotError("CONFLICT", "Signing claim changed");
            }
            Object.assign(setup, change);
          });
        },
      );
      return await repo.transact(scope, (d) => {
        const setup = d.setup.find((s) => s.id === id)!;
        setup.activityId = result.activityId;
        setup.status = result.status === "pending" ? "unknown" : result.status;
        setup.txHash = result.txHash ?? setup.txHash;
        d.accountId = result.accountId ?? d.accountId;
        d.encryptedToken = result.encryptedToken ?? d.encryptedToken;
        return setup;
      });
    } catch (error) {
      return repo.transact(scope, (d) => {
        const setup = d.setup.find((s) => s.id === id)!;
        const rejected =
          error instanceof InvalidSignedActivityError ||
          error instanceof SignedActivityRejectedError;
        setup.status = rejected ? "failed" : "unknown";
        setup.error = rejected ? "PERPL_SIGNATURE_REJECTED" : "PERPL_SETUP_UNKNOWN";
        return setup;
      });
    }
  }
  async function start(scope: PerplLiveScope, settings: PerplLiveSettings, key: string) {
    if (!deps.admissions) {
      throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Trading admissions are disabled");
    }
    return repo.transact(scope, (d, authority, now) => {
      const replay = d.sessions.find((s) => s.key === key);
      if (replay) {
        if (
          replay.settings.symbol !== settings.symbol ||
          replay.settings.marginMicros !== settings.marginMicros ||
          replay.settings.leverage !== settings.leverage ||
          replay.settings.cycles !== settings.cycles ||
          replay.settings.holdSeconds !== settings.holdSeconds
        ) {
          throw new PilotError("CONFLICT", "Start terms changed for this key");
        }
        return replay;
      }
      assertLiveSettings(settings, authority);
      if (d.setup.some((step) => !["confirmed", "failed"].includes(step.status))) {
        throw new PilotError(
          "PERPL_SETUP_PENDING",
          "Complete the pending account authorization first",
        );
      }
      if (!d.encryptedToken || !d.accountId || !d.keyExpiresAt || d.keyExpiresAt <= now) {
        throw new PilotError("PERPL_SETUP_REQUIRED", "Prepare the agent's Perpl account first");
      }
      if (
        d.sessions.some((s) => activeStatuses.has(s.status)) ||
        d.orders.some((o) => unresolved.has(o.status))
      ) {
        throw new PilotError("PERPL_SESSION_PENDING", "Resolve the existing trading session first");
      }
      const today = new Date(now).toISOString().slice(0, 10);
      const spent = d.orders
        .filter((o) => o.request.t <= 2 && new Date(o.createdAt).toISOString().startsWith(today))
        .reduce(
          (sum, o) =>
            sum + BigInt(d.sessions.find((s) => s.id === o.sessionId)!.settings.marginMicros),
          0n,
        );
      if (
        spent + liveAmount(settings.marginMicros) * BigInt(settings.cycles) >
        BigInt(authority.perDayMicros)
      ) {
        throw new PilotError("PERPL_DAY_LIMIT", "Daily margin limit reached");
      }
      const session = {
        id: deps.randomId(),
        key,
        settings,
        configVersion: authority.configVersion,
        status: "active" as const,
        completedCycles: 0,
        openedAt: null,
        createdAt: now,
        error: null,
        signalSource: "controlled-sequence-v1" as const,
      };
      d.sessions.push(session);
      return session;
    });
  }
  async function control(scope: PerplLiveScope, action: "pause" | "resume" | "stop" | "close") {
    return repo.transact(scope, (d, authority) => {
      assertLiveAuthority(authority, action === "resume");
      const s = [...d.sessions].reverse().find((session) => activeStatuses.has(session.status));
      if (!s) {
        throw new PilotError("PERPL_NO_SESSION", "No active trading session");
      }
      if (action === "resume") {
        if (!deps.admissions || s.status !== "paused") {
          throw new PilotError("PERPL_ENTRIES_PAUSED", "Trading cannot resume");
        }
        assertLiveSettings(s.settings, authority);
        s.status = "active";
      } else {
        s.status = action === "pause" ? "paused" : "stopping";
        if (action === "stop" || action === "close") {
          const last = d.orders.filter((order) => order.sessionId === s.id).at(-1);
          if (
            last &&
            last.request.t >= 3 &&
            ["rejected", "cancelled", "expired"].includes(last.status)
          ) {
            s.retryExitOrderId = last.id;
          }
        }
      }
      return s;
    });
  }
  async function tick(scope: PerplLiveScope) {
    const owner = deps.randomId();
    const claim = await repo.transact(scope, (d, authority, now) => {
      if (d.lease && d.lease.expiresAt > now) {
        return null;
      }
      d.lease = { owner, expiresAt: now + 60_000 };
      return { document: structuredClone(d), authority };
    });
    if (!claim) {
      return;
    }
    const guard = async (increasing: boolean) => {
      await repo.transact(scope, (d, authority, now) => {
        if (d.lease?.owner !== owner || d.lease.expiresAt <= now) {
          throw new PilotError("PERPL_LEASE_LOST", "Trading ownership expired");
        }
        d.lease.expiresAt = now + 60_000;
        assertLiveAuthority(authority, increasing);
        if (increasing && (!deps.admissions || d.sessions.at(-1)?.status !== "active")) {
          throw new PilotError("PERPL_ENTRIES_PAUSED", "New entries are paused");
        }
      });
    };
    try {
      for (const setup of claim.document.setup.filter(
        (s) => (s.txHash || s.activityId) && ["submitted", "unknown"].includes(s.status),
      )) {
        const result = await deps.driver.reconcileSetup(
          claim.authority,
          claim.document,
          setup,
          async () => {
            await guard(false);
            const { authority } = await repo.read(scope);
            assertLiveAuthority(authority, true);
            if (!(deps.setupAdmissions ?? deps.admissions)) {
              throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Account changes are disabled");
            }
          },
          async (change) => {
            await repo.transact(scope, (d) => {
              if (d.lease?.owner !== owner) {
                throw new PilotError("PERPL_LEASE_LOST", "Setup claim changed");
              }
              Object.assign(
                d.setup.find((s) => s.id === setup.id)!,
                change,
              );
            });
          },
        );
        if (result.confirmed || result.failed || result.txHash) {
          await repo.transact(scope, (d) => {
            if (d.lease?.owner !== owner) {
              throw new PilotError("PERPL_LEASE_LOST", "Setup claim changed");
            }
            const step = d.setup.find((s) => s.id === setup.id)!;
            step.status = result.confirmed ? "confirmed" : result.failed ? "failed" : "submitted";
            step.txHash = result.txHash ?? step.txHash;
            if (result.failed) {
              step.error = "PERPL_SETUP_FAILED";
            }
            d.accountId = result.accountId ?? d.accountId;
            d.encryptedToken = result.encryptedToken ?? d.encryptedToken;
          });
        }
      }
      if (!claim.document.encryptedToken) {
        return;
      }
      const snapshot = await deps.driver.snapshot(claim.authority, claim.document);
      const verified = new Set<string>();
      const alreadyVerified = new Set(claim.document.orders.flatMap((o) => o.verifiedTxHashes));
      for (const hash of new Set(snapshot.orders.flatMap((o) => o.txHashes))) {
        if (alreadyVerified.has(hash)) {
          verified.add(hash);
          continue;
        }
        if (await deps.driver.verifyTransaction(hash)) {
          verified.add(hash);
        }
      }
      const prepared = await repo.transact(scope, (d, authority, now) => {
        if (d.lease?.owner !== owner || d.lease.expiresAt <= now) {
          throw new PilotError("PERPL_LEASE_LOST", "Trading ownership expired");
        }
        d.snapshot = snapshot;
        d.accountId = snapshot.accountId;
        d.nextRequestId = Math.max(d.nextRequestId, snapshot.lastRequestId);
        for (const order of d.orders) {
          const evidence = snapshot.orders.find((o) => o.requestId === order.request.rq);
          if (!evidence) {
            if (order.status === "dispatching") {
              order.status = "unknown";
            }
            continue;
          }
          if (
            evidence.accountId !== order.request.acc ||
            evidence.marketId !== order.request.mkt ||
            evidence.type !== order.request.t ||
            evidence.originalSize !== order.request.s ||
            evidence.leverage !== order.request.lv ||
            evidence.filledSize > order.request.s
          ) {
            throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Order identity does not match");
          }
          order.evidence = evidence;
          order.verifiedTxHashes = evidence.txHashes.filter((hash) => verified.has(hash));
          order.status = evidence.status === "pending" ? "accepted" : evidence.status;
        }
        const s = [...d.sessions].reverse().find((session) => activeStatuses.has(session.status));
        if (!s) {
          return null;
        }
        const market = snapshot.markets.find((m) => m.symbol === s.settings.symbol);
        if (
          !market ||
          snapshot.accountId !== d.accountId ||
          snapshot.frozen ||
          !snapshot.forwarding ||
          snapshot.at > now + 5000 ||
          now - snapshot.at > 30_000
        ) {
          s.error = "PERPL_STATE_UNAVAILABLE";
          return null;
        }
        const ownOrders = d.orders.filter((o) => o.sessionId === s.id);
        if (s.status === "stopping" && ownOrders.length === 0) {
          s.status = "stopped";
          return null;
        }
        const observedPositions = snapshot.positions.filter((p) => !p.closed);
        if (s.preservedPositions === undefined && ownOrders.length === 0) {
          if (observedPositions.some((p) => p.marketId === market.id)) {
            s.status = "frozen";
            s.error = "PERPL_MARKET_OCCUPIED";
            return null;
          }
          s.preservedPositions = observedPositions.map(({ id, marketId }) => ({ id, marketId }));
        }
        const positions = observedPositions.filter(
          (p) =>
            !s.preservedPositions?.some(
              (preserved) =>
                p.marketId !== market.id &&
                preserved.id === p.id &&
                preserved.marketId === p.marketId,
            ),
        );
        if (positions.some((p) => p.marketId !== market.id) || positions.length > 1) {
          s.status = "frozen";
          s.error = "PERPL_UNEXPECTED_POSITION";
          return null;
        }
        if (d.orders.some((o) => unresolved.has(o.status))) {
          return null;
        }
        const last = ownOrders.at(-1);
        if (last && ["rejected", "cancelled", "expired"].includes(last.status)) {
          if (positions.length === 0 && s.status === "stopping") {
            s.status = "stopped";
            return null;
          }
          if (s.status !== "stopping" || last.request.t < 3 || s.retryExitOrderId !== last.id) {
            s.status = "frozen";
            s.error = "PERPL_ORDER_NOT_FILLED";
            return null;
          }
        }
        const position = positions[0];
        let request: PerplLiveOrderSpec;
        if (position) {
          if (!isPerplSessionPosition(d, s, position)) {
            s.status = "frozen";
            s.error = "PERPL_UNEXPECTED_POSITION";
            return null;
          }
          s.openedAt ??= now;
          if (s.status !== "stopping" && now < s.openedAt + s.settings.holdSeconds * 1000) {
            return null;
          }
          request = {
            rq: ++d.nextRequestId,
            mkt: market.id,
            acc: snapshot.accountId,
            t: position.side === "long" ? 3 : 4,
            p: 0,
            s: position.size,
            fl: 4,
            ms: market.maxSlippageBps,
            lv: position.leverage,
            lb: snapshot.head + market.ttlBlocks,
          };
        } else {
          if (last && last.request.t <= 2 && ["filled", "partial"].includes(last.status)) {
            // An order event can precede the position snapshot. Never open again across that gap.
            if (
              snapshot.positions.some(
                (p) => p.closed && ownOrders.some((o) => o.request.rq === p.requestId),
              )
            ) {
              s.status = "frozen";
              s.error = "PERPL_POSITION_CLOSED_EXTERNALLY";
            }
            return null;
          }
          if (
            s.openedAt !== null &&
            last &&
            last.request.t >= 3 &&
            ["filled", "partial"].includes(last.status)
          ) {
            s.completedCycles++;
          }
          s.openedAt = null;
          if (s.status === "stopping" || s.completedCycles >= s.settings.cycles) {
            s.status = s.status === "stopping" ? "stopped" : "completed";
            return null;
          }
          if (
            s.status !== "active" ||
            !deps.admissions ||
            authority.paused ||
            authority.killed ||
            !authority.enabled ||
            authority.configVersion !== s.configVersion
          ) {
            return null;
          }
          assertLiveSettings(s.settings, authority);
          if (snapshot.unmanagedOrders) {
            s.status = "frozen";
            s.error = "PERPL_UNEXPECTED_ORDER";
            return null;
          }
          const day = new Date(now).toISOString().slice(0, 10);
          const spent = d.orders
            .filter(
              (o) =>
                o.request.t <= 2 &&
                o.status !== "cancelled" &&
                new Date(o.createdAt).toISOString().startsWith(day),
            )
            .reduce(
              (sum, o) =>
                sum +
                BigInt(
                  d.sessions.find((session) => session.id === o.sessionId)!.settings.marginMicros,
                ),
              0n,
            );
          if (spent + liveAmount(s.settings.marginMicros) > BigInt(authority.perDayMicros)) {
            s.status = "frozen";
            s.error = "PERPL_DAY_LIMIT";
            return null;
          }
          const margin = liveAmount(s.settings.marginMicros);
          const reserve = (margin * BigInt(market.takerFeeMicros) * 2n + 999_999n) / 1_000_000n;
          if (BigInt(snapshot.balanceMicros) - BigInt(snapshot.lockedMicros) < margin + reserve) {
            s.status = "frozen";
            s.error = "PERPL_INSUFFICIENT_COLLATERAL";
            return null;
          }
          request = {
            rq: ++d.nextRequestId,
            mkt: market.id,
            acc: snapshot.accountId,
            t: 1,
            p: 0,
            s: liveOrderSize(s.settings.marginMicros, s.settings.leverage, market),
            fl: 4,
            ms: market.maxSlippageBps,
            lv: s.settings.leverage * 100,
            lb: snapshot.head + market.ttlBlocks,
          };
        }
        const order = {
          market: structuredClone(market),
          id: deps.randomId(),
          sessionId: s.id,
          request,
          status: "prepared" as const,
          createdAt: now,
          submittedAt: null,
          evidence: null,
          verifiedTxHashes: [],
          error: null,
        };
        delete s.retryExitOrderId;
        d.orders.push(order);
        return { order, document: structuredClone(d) };
      });
      if (!prepared) {
        return;
      }
      const increasing = prepared.order.request.t <= 2;
      await guard(increasing);
      const head = deps.driver.executionHead
        ? await deps.driver.executionHead(prepared.document)
        : snapshot.head;
      await repo.transact(scope, (d, authority, now) => {
        assertLiveAuthority(authority, increasing);
        if (
          d.lease?.owner !== owner ||
          d.lease.expiresAt <= now ||
          (increasing && d.sessions.at(-1)?.status !== "active")
        ) {
          throw new PilotError("PERPL_LEASE_LOST", "Order dispatch claim lost");
        }
        const order = d.orders.find((o) => o.id === prepared.order.id)!;
        if (!Number.isSafeInteger(head) || head < snapshot.head) {
          throw new PilotError("PERPL_STATE_UNAVAILABLE", "Execution head is unavailable");
        }
        order.request.lb = head + order.market.ttlBlocks;
        prepared.order.request = structuredClone(order.request);
        order.status = "dispatching";
        order.submittedAt = now;
      });
      let status: "accepted" | "rejected" | "unknown" = "unknown";
      try {
        status = await deps.driver.submit(prepared.document, prepared.order.request, () =>
          guard(increasing),
        );
      } finally {
        await repo.transact(scope, (d) => {
          const order = d.orders.find((o) => o.id === prepared.order.id)!;
          if (order.status === "dispatching") {
            order.status = status;
          }
        });
      }
    } catch (error) {
      await repo.transact(scope, (d) => {
        if (d.lease?.owner !== owner) {
          return;
        }
        // Only an intent that never crossed dispatch can be cancelled as definitely unsent.
        for (const order of d.orders.filter((o) => o.status === "prepared")) {
          order.status = "cancelled";
          order.error = "PERPL_NOT_DISPATCHED";
        }
        const session = d.sessions.at(-1);
        if (session && activeStatuses.has(session.status)) {
          session.error = error instanceof PilotError ? error.code : "PERPL_SYNC_UNAVAILABLE";
        }
      });
    } finally {
      await repo.transact(scope, (d) => {
        if (d.lease?.owner === owner) {
          d.lease = null;
        }
      });
    }
  }
  return {
    state,
    prepareSetup,
    connectExistingKey,
    confirmSetup,
    start,
    control,
    tick,
    async tickDue() {
      let again = false;
      for (const scope of await repo.due(10)) {
        await tick(scope);
        const { document } = await repo.read(scope);
        if (document?.sessions.some((session) => ["active", "stopping"].includes(session.status))) {
          again = true;
        }
      }
      return again;
    },
  };
}

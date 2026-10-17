import { PilotError } from "@pickler/core";
import { applyPaperMarks } from "../perps-paper/simulation.js";
import {
  assertBreakoutAcceptance,
  assertHourlyBreakoutConfig,
  BREAKOUT_DECISION_MS,
  BREAKOUT_HOUR_MS,
  breakoutCloseFenced,
  breakoutHash,
  breakoutPreparationExclusions,
  breakoutSmaProposals,
  breakoutWindowTimes,
  detectBreakoutCloses,
  hourlyBreakoutSignal,
  planBreakoutDiscoveries,
  planBreakoutSmaDiscoveries,
} from "./policy.js";
import { breakoutCommitTiming } from "./clock.js";
import { BreakoutOperationMemory } from "./operation-memory.js";
import type {
  BreakoutCoordinatorDependencies,
  BreakoutCloseObligation,
  BreakoutDiscovery,
  BreakoutDurableResult,
  BreakoutFinalSet,
  BreakoutFinancialRole,
  BreakoutInitialSet,
  BreakoutReservedHead,
  BreakoutScreenSnapshot,
} from "./types.js";

export interface BreakoutCycleResult {
  status: "COMPLETE" | "NO_NEW_DECISION" | "FINAL_UNAVAILABLE" | "ADMISSIONS_STOPPED";
  operationId: string;
  finalOperationId: string | null;
  discoveries: readonly BreakoutDiscovery[];
  unknown: boolean;
  technicalFailures: readonly string[];
}

const safeCode = (error: unknown) =>
  error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "UNEXPECTED_FINAL_FAILURE";
const isPublicDataOmission = (error: unknown) =>
  error instanceof PilotError &&
  [
    "MARKET_DATA_UNAVAILABLE",
    "STALE_MARKET_DATA",
    "DATA_UNAVAILABLE",
    "HISTORY_UNAVAILABLE",
    "PERPL_DATA_UNAVAILABLE",
    "ACQUISITION_TIMEOUT",
  ].includes(error.code);

/** Native business/availability cancellations may remain local to their original account. */
const ordinaryFinancialRejections = new Set([
  "RISK_REJECTED",
  "EXIT_REQUIRED",
  "ADMISSIONS_CLOSED",
  "MARKET_DATA_UNAVAILABLE",
  "STALE_MARKET_DATA",
  "DATA_UNAVAILABLE",
  "HISTORY_UNAVAILABLE",
  "PERPL_DATA_UNAVAILABLE",
  "ACQUISITION_TIMEOUT",
  "INSUFFICIENT_DEPTH",
  "QUANTITY_TOO_SMALL",
  "UNSUPPORTED_FEE",
  "FINAL_SIGNAL_INPUT_REJECTED",
  "SMA_FINAL_GATE_CHANGED",
  "BREAKOUT_FINAL_WINDOW_REJECTED",
]);
const selectiveOnly = (obligation: BreakoutCloseObligation) =>
  obligation.reasons.length === 1 && obligation.reasons[0] === "SELECTIVE_EXPOSURE";
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      immutable(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** Scheduling, I/O and transactions are injected; all admission and serial policy lives here. */
export function createHourlyBreakoutCoordinator(dependencies: BreakoutCoordinatorDependencies) {
  const { config, acceptance, repository, lease, digest } = dependencies;
  assertHourlyBreakoutConfig(config);
  assertBreakoutAcceptance(acceptance, dependencies.clock());
  const times = breakoutWindowTimes(acceptance.T0);
  let lastFinancialAt = Number.NEGATIVE_INFINITY;
  let stopped = false;
  const operationMemory = new BreakoutOperationMemory(digest);

  async function guard(signal: AbortSignal) {
    signal.throwIfAborted();
    lease.assertActive?.();
    await repository.guard(config, lease);
    const at = dependencies.clock();
    if (!Number.isSafeInteger(at) || at < lastFinancialAt) {
      stopped = true;
      throw new PilotError("CLOCK_PROOF_FAILURE", "Financial clock regressed or is unsafe");
    }
    lastFinancialAt = at;
    return at;
  }

  async function unknown<T>(
    result: BreakoutDurableResult<T>,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (result.status === "rolled_back" && result.code === "LEASE_LOST") {
      stopped = true;
      throw new PilotError("LEASE_LOST", "Durable operation reports lost ownership");
    }
    if (result.status !== "unknown") {
      return false;
    }
    stopped = true;
    signal.throwIfAborted();
    await repository.recordBarrier(config, lease, {
      operationId: result.operationId,
      affectedRoles: result.affectedRoles,
      code: result.code,
      detectedAt: dependencies.clock(),
    });
    return true;
  }

  async function recordQ(
    operationId: string,
    role: BreakoutFinancialRole,
    marketId: number,
    action: "OPEN" | "FULL_CLOSE",
    obligationId: string,
    scheduledAt: number,
    finalOperationId: string,
    sourceAcquired = false,
  ) {
    const key = breakoutHash(
      [acceptance.protocolDigest, role, marketId, operationId, action, obligationId],
      digest,
    );
    await repository.event(config, lease, `breakout-q:${key}`, "breakout-action-obligation", {
      key,
      protocolDigest: acceptance.protocolDigest,
      role,
      marketId,
      originalOperationId: operationId,
      action,
      actionObligationId: obligationId,
      scheduledAt,
      finalOperationId,
      originalSourceAssignedBeforeAcquisition: !sourceAcquired,
    });
    return key;
  }

  function due(
    snapshot: BreakoutScreenSnapshot,
    initial: BreakoutInitialSet,
    final: BreakoutFinalSet | null,
    decision: boolean,
    at: number,
  ) {
    const observation = final?.observation ?? initial.observation;
    const windows = final?.windows ?? initial.markets.flatMap((m) => (m.window ? [m.window] : []));
    const evidence = final?.smaEvidence ?? initial.smaEvidence;
    return snapshot.accounts.flatMap((state) => {
      const accountUnknown = snapshot.unknownBarriers.some((b) =>
        b.affectedRoles.includes(state.role),
      );
      let account = state.view.account;
      try {
        account = applyPaperMarks(account, observation.frames, at, dependencies.receiptClock());
      } catch (error) {
        if (!isPublicDataOmission(error)) {
          stopped = true;
          throw error;
        }
        // Missing marks cannot erase independent age, terminal or previously latched obligations.
      }
      const smaCloseSymbols =
        decision && state.role === "S"
          ? breakoutSmaProposals({ account, evidence }, config)
              .filter((p) => p.action === "close")
              .map((p) => p.symbol)
          : [];
      return detectBreakoutCloses({
        role: state.role,
        account,
        attempts: state.view.attempts,
        frames: observation.frames,
        at,
        operationId: initial.operationId,
        digest,
        terminal: at >= times.TA,
        unknown: accountUnknown,
        signals: windows.map((w) => ({
          symbol: w.market.symbol,
          signal: hourlyBreakoutSignal(w, digest),
        })),
        smaCloseSymbols,
      });
    });
  }

  async function latch(
    snapshot: BreakoutScreenSnapshot,
    initial: BreakoutInitialSet,
    final: BreakoutFinalSet | null,
    decision: boolean,
    signal: AbortSignal,
  ) {
    const obligations = due(snapshot, initial, final, decision, await guard(signal));
    if (obligations.length) {
      const result = await repository.latchCloses(config, lease, obligations);
      await unknown(result, signal);
      if (result.status === "rolled_back") {
        throw new PilotError(
          "EXIT_OBLIGATION_NOT_DURABLE",
          "Required exit obligation did not commit",
        );
      }
    }
    if (
      [...snapshot.closeObligations, ...obligations].some(
        (obligation) => obligation.state !== "CONFIRMED" && selectiveOnly(obligation),
      )
    ) {
      const reconciled = await repository.reconcileSelective(config, lease, {
        operationId: `${final?.operationId ?? initial.operationId}:selective-reconciliation`,
        observation: final?.observation ?? initial.observation,
      });
      await unknown(reconciled, signal);
      if (
        reconciled.status === "rolled_back" &&
        !ordinaryFinancialRejections.has(reconciled.code)
      ) {
        stopped = true;
        throw new PilotError(reconciled.code, "Selective intent reconciliation failed");
      }
    }
    return repository.snapshot(config, lease);
  }

  async function rejectUnexecuted(head: BreakoutReservedHead, code: string, signal: AbortSignal) {
    await guard(signal);
    const result = await repository.rejectHead(config, lease, {
      head,
      code,
      noEffectAcknowledgement: null,
      knownUnexecuted: true,
    });
    await unknown(result, signal);
    if (result.status === "rolled_back") {
      stopped = true;
      throw new PilotError(
        "RESERVATION_RELEASE_UNCONFIRMED",
        "Required terminal rejection did not commit",
      );
    }
    operationMemory.remember("terminal-attempt", head.discovery.attemptId);
    return result.status === "confirmed";
  }

  async function process(
    initial: BreakoutInitialSet,
    signal: AbortSignal,
    decision: boolean,
  ): Promise<BreakoutCycleResult> {
    initial = immutable(structuredClone(initial));
    const at = await guard(signal);
    const result: BreakoutCycleResult = {
      status: "COMPLETE",
      operationId: initial.operationId,
      finalOperationId: null,
      discoveries: [],
      unknown: false,
      technicalFailures: [],
    };
    const failures: string[] = [];
    function recordFinancialRejection(code: string) {
      if (code === "LEASE_LOST") {
        throw new PilotError("LEASE_LOST", "Financial rollback reports lost ownership");
      }
      if (!ordinaryFinancialRejections.has(code)) {
        stopped = true;
        failures.push(code);
      }
    }
    if (
      !initial.operationId ||
      !Number.isSafeInteger(initial.scheduledAt) ||
      initial.scheduledAt < times.T0 ||
      initial.scheduledAt > times.TV ||
      initial.scheduledAt % (decision ? BREAKOUT_DECISION_MS : 60_000) !== 0 ||
      !Number.isSafeInteger(initial.D) ||
      initial.D < initial.scheduledAt ||
      (decision && initial.D >= initial.scheduledAt + BREAKOUT_DECISION_MS) ||
      initial.D > initial.sourceDeadlineAt ||
      initial.D > at ||
      initial.financialAt > initial.D ||
      initial.receiptAt > dependencies.receiptClock()
    ) {
      throw new PilotError(
        "BREAKOUT_INITIAL_WINDOW_REJECTED",
        "Original scheduled common initial operation required",
      );
    }
    const previousOperation = operationMemory.lookup("operation", initial.operationId);
    if (previousOperation === "POSSIBLY_OLDER") {
      stopped = true;
      throw new PilotError(
        "OPERATION_TOMBSTONE_PROOF_UNAVAILABLE",
        "Older or colliding operation cannot be sampled or executed again",
      );
    }
    if (previousOperation === "RECENT_EXACT") {
      const original = await repository.snapshot(config, lease);
      return { ...result, status: "NO_NEW_DECISION", unknown: original.unknownBarriers.length > 0 };
    }
    operationMemory.remember("operation", initial.operationId);
    let snapshot = await repository.snapshot(config, lease);
    const duplicate =
      decision && (await repository.hasDiscoveryOperation(config, lease, initial.operationId));
    if (decision && duplicate) {
      return { ...result, status: "NO_NEW_DECISION", unknown: snapshot.unknownBarriers.length > 0 };
    }
    const admissionAllowed =
      decision && !stopped && !snapshot.unknownBarriers.length && at < times.TA;
    const observedRoles = snapshot.accounts
      .filter((a) => !snapshot.unknownBarriers.some((b) => b.affectedRoles.includes(a.role)))
      .map((a) => a.role);
    let initialValuationUnavailable = false;
    if (observedRoles.length) {
      const observed = await repository.observe(config, lease, {
        operationId: `${initial.operationId}:initial-valuation`,
        observation: initial.observation,
        financialAt: initial.financialAt,
        receiptAt: initial.receiptAt,
        sourceDeadlineAt: initial.sourceDeadlineAt,
        roles: observedRoles,
      });
      await unknown(observed, signal);
      if (observed.status === "rolled_back") {
        if (
          !isPublicDataOmission(new PilotError(observed.code, "Original observation rolled back"))
        ) {
          stopped = true;
          throw new PilotError(observed.code, "Unexpected original observation failure");
        }
        initialValuationUnavailable = true;
      } else if (
        observed.status === "confirmed" &&
        observed.acknowledgement.receiptStatus !== undefined &&
        observed.acknowledgement.receiptStatus !== "QUALIFIED"
      ) {
        stopped = true;
        failures.push("GAP_COMPLIANCE_UNPROVED");
      }
      snapshot = await repository.snapshot(config, lease);
    }
    if (at >= times.TA) {
      stopped = true;
      const closed = await repository.closeAdmissions(
        config,
        lease,
        `${acceptance.protocolDigest}:terminal-admissions`,
      );
      await unknown(closed, signal);
      if (closed.status === "rolled_back") {
        failures.push("TERMINAL_ADMISSIONS_NOT_DURABLE");
      }
    }
    const H = Math.floor(initial.scheduledAt / BREAKOUT_HOUR_MS) * BREAKOUT_HOUR_MS;
    const finalOperationId = `${initial.operationId}:original-final`;
    const discoveries: BreakoutDiscovery[] = [];
    if (admissionAllowed && !snapshot.unknownBarriers.length && !duplicate) {
      const unavailablePreparation = new Set(
        breakoutPreparationExclusions(initial.smaEvidence).map((e) => e.symbol),
      );
      if (initial.scheduledAt % BREAKOUT_HOUR_MS === 0) {
        for (const role of ["C", "L"] as const) {
          discoveries.push(
            ...planBreakoutDiscoveries({
              role,
              initialOperationId: initial.operationId,
              finalOperationId,
              H,
              D: initial.D,
              markets: initial.markets.map((m) => ({
                ...m,
                financialReady:
                  m.financialReady &&
                  !initialValuationUnavailable &&
                  !failures.length &&
                  !unavailablePreparation.has(m.symbol),
                unavailableReasons: [
                  ...m.unavailableReasons,
                  ...(initialValuationUnavailable ? ["INITIAL_VALUATION_UNAVAILABLE"] : []),
                  ...(unavailablePreparation.has(m.symbol)
                    ? ["NATIVE_PREPARATION_UNAVAILABLE"]
                    : []),
                ],
              })),
              snapshot,
              digest,
            }),
          );
        }
      }
      const account = snapshot.accounts.find((a) => a.role === "S")?.view.account;
      if (account && !failures.length && !initialValuationUnavailable) {
        discoveries.push(
          ...planBreakoutSmaDiscoveries({
            config,
            context: { account, evidence: initial.smaEvidence },
            snapshot,
            initialOperationId: initial.operationId,
            finalOperationId,
            digest,
          }),
        );
      }
      // Commit every structurally known event even when it has no financial entitlement.
      const committed = await repository.commitDiscovery(config, lease, {
        operationId: initial.operationId,
        H,
        D: initial.D,
        discoveries,
        initialEvidence: initial,
      });
      await unknown(committed, signal);
      if (committed.status === "rolled_back") {
        stopped = true;
        failures.push("DISCOVERY_NOT_DURABLE");
      }
      snapshot = await repository.snapshot(config, lease);
    }
    snapshot = await latch(snapshot, initial, null, decision, signal);
    result.discoveries = discoveries;
    const openings = discoveries.filter((d) => d.state === "QUEUED");
    const originallySelectedCloses = snapshot.closeObligations.filter(
      (o) =>
        o.state !== "CONFIRMED" &&
        !snapshot.unknownBarriers.some((b) => b.affectedRoles.includes(o.role)) &&
        !snapshot.accounts
          .find((a) => a.role === o.role)
          ?.view.attempts.some((a) => a.status === "pending"),
    );
    if (!openings.length && !originallySelectedCloses.length) {
      result.status = duplicate
        ? "NO_NEW_DECISION"
        : stopped || snapshot.unknownBarriers.length
          ? "ADMISSIONS_STOPPED"
          : "COMPLETE";
      return {
        ...result,
        unknown: snapshot.unknownBarriers.length > 0,
        technicalFailures: failures,
      };
    }
    for (const opening of openings) {
      await recordQ(
        initial.operationId,
        opening.role,
        opening.marketId,
        "OPEN",
        opening.allocationId,
        initial.scheduledAt,
        finalOperationId,
      );
    }
    for (const close of originallySelectedCloses) {
      await recordQ(
        initial.operationId,
        close.role,
        close.marketId,
        "FULL_CLOSE",
        close.id,
        initial.scheduledAt,
        finalOperationId,
      );
    }
    // Potential intents have identities before acquisition but are not Q members or financial
    // attempts until a due reduction is actually selected. Later reasons reuse this identity.
    const preassignedCloseIds = new Set<string>();
    for (const state of snapshot.accounts) {
      for (const position of state.view.account.positions.filter((p) => p.closedAt === null)) {
        const market = config.markets.find((m) => m.symbol === position.symbol);
        if (!market) {
          throw new PilotError(
            "PERPL_MARKET_IDENTITY",
            "Recorded position must belong to the fixed universe",
          );
        }
        const id = breakoutHash([state.view.account.scope, position.id, "FULL_CLOSE"], digest);
        const key = breakoutHash(
          [
            acceptance.protocolDigest,
            state.role,
            market.marketId,
            initial.operationId,
            "FULL_CLOSE",
            id,
          ],
          digest,
        );
        await repository.event(
          config,
          lease,
          `breakout-potential-close:${key}`,
          "breakout-potential-close-intent",
          {
            key,
            id,
            role: state.role,
            marketId: market.marketId,
            positionId: position.id,
            side: position.side,
            quantity: position.quantity,
            originalOperationId: initial.operationId,
            scheduledAt: initial.scheduledAt,
            finalOperationId,
            Q_member: false,
          },
        );
        preassignedCloseIds.add(id);
      }
    }
    // At most one real reservation exists before the one original common final acquisition.
    let reserved: BreakoutReservedHead | null = null;
    const first = openings.find(
      (opening) =>
        !snapshot.closeObligations.some((o) => o.role === opening.role && o.state !== "CONFIRMED"),
    );
    if (first && !stopped && !snapshot.unknownBarriers.length) {
      const admitted = await repository.reserveHead(config, lease, first);
      await unknown(admitted, signal);
      if (admitted.status === "confirmed") {
        reserved = admitted.value;
      } else if (admitted.status === "rolled_back") {
        recordFinancialRejection(admitted.code);
        operationMemory.remember("terminal-attempt", first.attemptId);
      }
    }
    let finalSet: BreakoutFinalSet;
    try {
      await guard(signal);
      finalSet = immutable(
        structuredClone(
          await dependencies.finalEvidence({ operationId: finalOperationId, initial, signal }),
        ),
      );
      if (
        finalSet.operationId !== finalOperationId ||
        finalSet.initialOperationId !== initial.operationId ||
        finalSet.H !== H ||
        finalSet.financialAt < initial.D ||
        finalSet.receiptAt < initial.receiptAt ||
        finalSet.financialAt > finalSet.sourceDeadlineAt
      ) {
        throw new PilotError("FINAL_OPERATION_IDENTITY", "Original shared final operation changed");
      }
    } catch (error) {
      if (reserved) {
        await rejectUnexecuted(reserved, safeCode(error), signal);
      }
      await repository.event(
        config,
        lease,
        `${initial.operationId}:final-unavailable`,
        "breakout-final-unavailable",
        { finalOperationId, code: safeCode(error), unattempted: openings.map((o) => o.attemptId) },
      );
      for (const opening of openings) {
        operationMemory.remember("terminal-attempt", opening.attemptId);
      }
      if (!isPublicDataOmission(error)) {
        stopped = true;
        await repository.closeAdmissions(
          config,
          lease,
          `${initial.operationId}:technical-admissions-stop`,
        );
        throw error;
      }
      return {
        ...result,
        status: "FINAL_UNAVAILABLE",
        finalOperationId,
        unknown: stopped,
        technicalFailures: failures,
      };
    }
    result.finalOperationId = finalOperationId;
    const selectedCloseIds = new Set(originallySelectedCloses.map((o) => o.id));
    const attemptedCloseIds = new Set<string>();
    async function reductions(depth = 0): Promise<boolean> {
      if (depth > 15) {
        throw new PilotError(
          "EXIT_OBLIGATION_NOT_DURABLE",
          "Full reductions did not reach a stable actual portfolio",
        );
      }
      snapshot = await repository.snapshot(config, lease);
      snapshot = await latch(snapshot, initial, finalSet, decision, signal);
      const obligations = snapshot.closeObligations
        .filter((o) => o.state !== "CONFIRMED")
        .sort((left, right) => Number(selectiveOnly(left)) - Number(selectiveOnly(right)));
      for (const obligation of obligations) {
        if (attemptedCloseIds.has(obligation.id)) {
          continue;
        }
        if (snapshot.unknownBarriers.some((b) => b.affectedRoles.includes(obligation.role))) {
          continue;
        }
        if (
          selectiveOnly(obligation) &&
          obligations.some((other) => other.role === obligation.role && !selectiveOnly(other))
        ) {
          continue;
        }
        if (reserved?.discovery.role === obligation.role) {
          if (!(await rejectUnexecuted(reserved, "EXIT_REQUIRED_BEFORE_OPEN", signal))) {
            return false;
          }
          reserved = null;
          snapshot = await repository.snapshot(config, lease);
        }
        if (
          snapshot.accounts
            .find((a) => a.role === obligation.role)
            ?.view.attempts.some((a) => a.status === "pending")
        ) {
          continue;
        }
        if (!selectedCloseIds.has(obligation.id)) {
          // A new reason reuses a position-bound intent that existed before acquisition.
          // A newly opened position has no such proof and cannot retrospectively pass Q.
          const preassigned = preassignedCloseIds.has(obligation.id);
          await recordQ(
            initial.operationId,
            obligation.role,
            obligation.marketId,
            "FULL_CLOSE",
            obligation.id,
            initial.scheduledAt,
            finalOperationId,
            !preassigned,
          );
          selectedCloseIds.add(obligation.id);
          if (!preassigned) {
            failures.push("FINAL_CLOSE_SOURCE_NOT_PREASSIGNED");
          }
        }
        await guard(signal);
        attemptedCloseIds.add(obligation.id);
        const reduced = await repository.close(config, lease, { obligation, finalSet });
        await unknown(reduced, signal);
        if (reduced.status === "rolled_back") {
          recordFinancialRejection(reduced.code);
          failures.push("REQUIRED_CLOSE_UNEXECUTED");
        } else if (reduced.status === "confirmed") {
          if (
            reduced.acknowledgement.receiptStatus !== undefined &&
            reduced.acknowledgement.receiptStatus !== "QUALIFIED"
          ) {
            stopped = true;
            failures.push("GAP_COMPLIANCE_UNPROVED");
          }
          // Re-read and replan after each actual close, including across account roles.
          return reductions(depth + 1);
        }
        snapshot = await repository.snapshot(config, lease);
      }
      return true;
    }
    await reductions();
    for (const opening of openings) {
      const terminalAttempt = operationMemory.lookup("terminal-attempt", opening.attemptId);
      if (terminalAttempt === "POSSIBLY_OLDER") {
        stopped = true;
        failures.push("ATTEMPT_TOMBSTONE_PROOF_UNAVAILABLE");
      }
      if (terminalAttempt !== "NEW") {
        continue;
      }
      const currentAt = await guard(signal);
      snapshot = await repository.snapshot(config, lease);
      if (
        stopped ||
        snapshot.unknownBarriers.length ||
        currentAt >= times.TA ||
        breakoutCloseFenced(snapshot, opening.role, opening.symbol, currentAt)
      ) {
        if (
          reserved?.discovery.attemptId === opening.attemptId &&
          !snapshot.unknownBarriers.some((b) => b.affectedRoles.includes(opening.role))
        ) {
          await rejectUnexecuted(reserved, "ADMISSIONS_STOPPED", signal);
          reserved = null;
        }
        continue;
      }
      await reductions();
      snapshot = await repository.snapshot(config, lease);
      if (
        snapshot.closeObligations.some((o) => o.role === opening.role && o.state !== "CONFIRMED")
      ) {
        continue;
      }
      const deadline = (opening.role === "S" ? initial.scheduledAt : H) + BREAKOUT_DECISION_MS;
      if (dependencies.clock() >= deadline) {
        if (reserved?.discovery.attemptId === opening.attemptId) {
          await rejectUnexecuted(reserved, "BREAKOUT_FINAL_WINDOW_REJECTED", signal);
          reserved = null;
        }
        continue;
      }
      if (!reserved || reserved.discovery.attemptId !== opening.attemptId) {
        const admitted = await repository.reserveHead(config, lease, opening);
        await unknown(admitted, signal);
        if (admitted.status !== "confirmed") {
          if (admitted.status === "rolled_back") {
            recordFinancialRejection(admitted.code);
          }
          operationMemory.remember("terminal-attempt", opening.attemptId);
          continue;
        }
        reserved = admitted.value;
      }
      const completed = await repository.executeHead(config, lease, {
        head: reserved,
        finalSet,
        deadline,
        expectedWindowDigest: opening.windowDigest,
      });
      await unknown(completed, signal);
      operationMemory.remember("terminal-attempt", opening.attemptId);
      if (completed.status === "rolled_back") {
        recordFinancialRejection(completed.code);
        const rejected = await repository.rejectHead(config, lease, {
          head: reserved,
          code: completed.code,
          noEffectAcknowledgement: completed.acknowledgement,
        });
        await unknown(rejected, signal);
        if (rejected.status !== "confirmed") {
          stopped = true;
          failures.push("RESERVATION_RELEASE_UNCONFIRMED");
        }
      } else if (completed.status === "confirmed") {
        const timing = breakoutCommitTiming("confirmed", completed.acknowledgement, deadline);
        if (timing !== "CONFIRMED_WITHIN_ACK_WINDOW") {
          stopped = true;
          failures.push(timing);
        }
        if (
          completed.acknowledgement.receiptStatus === "KNOWN_EFFECT_V_UNPROVED" ||
          completed.acknowledgement.receiptStatus === "ORIGINAL_RECEIPT_UNAVAILABLE"
        ) {
          stopped = true;
          failures.push("GAP_COMPLIANCE_UNPROVED");
        }
      }
      reserved = null;
      // A stop/age/channel obligation becoming due during this head precedes every later head.
      await reductions();
    }
    if (reserved) {
      const current = await repository.snapshot(config, lease);
      if (
        !current.unknownBarriers.some((b) => b.affectedRoles.includes(reserved!.discovery.role))
      ) {
        await rejectUnexecuted(reserved, "ORIGINAL_QUEUE_TERMINATED", signal);
      }
    }
    snapshot = await repository.snapshot(config, lease);
    if (failures.length || stopped || snapshot.unknownBarriers.length) {
      stopped = true;
      result.status = "ADMISSIONS_STOPPED";
      const closed = await repository.closeAdmissions(
        config,
        lease,
        `${initial.operationId}:technical-admissions-stop`,
      );
      await unknown(closed, signal);
    }
    return {
      ...result,
      unknown: snapshot.unknownBarriers.length > 0,
      technicalFailures: [...new Set(failures)],
    };
  }

  return {
    cycle: (initial: BreakoutInitialSet, signal: AbortSignal) => process(initial, signal, true),
    maintenance: (initial: BreakoutInitialSet, signal: AbortSignal) =>
      process(initial, signal, false),
    async reconcileFunding(
      initial: BreakoutInitialSet,
      signal: AbortSignal,
    ): Promise<BreakoutCycleResult> {
      const at = await guard(signal);
      if (
        initial.scheduledAt < times.TV ||
        initial.scheduledAt >= times.TF ||
        at >= times.TF ||
        initial.D > at ||
        initial.D > initial.sourceDeadlineAt ||
        initial.observation.marksOnly === true
      ) {
        throw new PilotError(
          "BREAKOUT_FUNDING_WINDOW_REJECTED",
          "Original funding-only operation before fixed TF required",
        );
      }
      const snapshot = await repository.snapshot(config, lease);
      const roles = snapshot.accounts
        .filter(
          (a) =>
            !snapshot.unknownBarriers.some((b) => b.affectedRoles.includes(a.role)) &&
            a.view.account.positions.every((p) => p.closedAt !== null),
        )
        .map((a) => a.role);
      const failures: string[] = [];
      if (roles.length !== 3) {
        failures.push("INCOMPLETE_OR_UNKNOWN_LIABILITY_AT_TV");
      }
      if (roles.length) {
        const observed = await repository.observe(config, lease, {
          operationId: `${initial.operationId}:funding-reconciliation`,
          observation: initial.observation,
          financialAt: initial.financialAt,
          receiptAt: initial.receiptAt,
          sourceDeadlineAt: initial.sourceDeadlineAt,
          roles,
        });
        await unknown(observed, signal);
        if (observed.status === "rolled_back") {
          failures.push("FUNDING_RECONCILIATION_UNAVAILABLE");
        }
      }
      return {
        status: failures.length || stopped ? "ADMISSIONS_STOPPED" : "COMPLETE",
        operationId: initial.operationId,
        finalOperationId: null,
        discoveries: [],
        unknown: snapshot.unknownBarriers.length > 0,
        technicalFailures: failures,
      };
    },
  };
}

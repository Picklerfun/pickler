import test from "node:test";
import assert from "node:assert/strict";
import { PilotError } from "@pickler/core";
import {
  assertBreakoutHead,
  breakoutOpeningIntent,
  createHourlyBreakoutCoordinator,
  type BreakoutAcknowledgement,
  type BreakoutDurableResult,
  type BreakoutFinalSet,
  type BreakoutFinancialRole,
  type BreakoutReservedHead,
  type BreakoutScreenRepository,
} from "../src/evaluation.js";
import {
  applyPaperFill,
  applyPaperMarks,
  applyPaperObservation,
  paperRisk,
  selectiveReduction,
  simulatePerpsFill,
} from "../src/perps.js";
import {
  breakoutAcceptance,
  breakoutConfig,
  breakoutDigest,
  breakoutFrame,
  breakoutInitial,
  breakoutSnapshot,
  breakoutT0,
} from "./hourly-breakout-fixture.js";

/** Controlled in-memory adapter; all economics remain the production native functions. */
function controlled(
  mode:
    | "fill"
    | "rollback"
    | "unknown"
    | "reject-unknown"
    | "late"
    | "age-copy"
    | "v-unproved"
    | "reserve-persistence"
    | "later-reserve-persistence"
    | "execute-persistence"
    | "execute-permission"
    | "close-persistence"
    | "reserve-risk"
    | "reserve-lease-lost"
    | "defer-invalid-mark"
    | "selective-then-age" = "fill",
) {
  const state = breakoutSnapshot();
  let at = breakoutT0 + 1000;
  let finalCalls = 0;
  const calls: string[] = [];
  const initial = breakoutInitial(
    breakoutT0,
    mode === "selective-then-age" ? [1, 10, 20] : [1, 20],
  );
  const markTripled = (frame: ReturnType<typeof breakoutFrame>) => {
    frame.snapshot.ticker.mark = "300";
    frame.snapshot.ticker.index = "300";
    frame.snapshot.ticker.last = "300";
    frame.snapshot.ticker.bid = "299.9";
    frame.snapshot.ticker.ask = "300.1";
    frame.book.bids = [{ price: "299.9", size: "1000", orders: 1 }];
    frame.book.asks = [{ price: "300.1", size: "1000", orders: 1 }];
    return frame;
  };
  if (mode === "selective-then-age") {
    initial.observation.frames.forEach(markTripled);
  }
  const accepted = breakoutAcceptance();
  const lease = { owner: "controlled-study-owner", expiresAt: breakoutT0 + 90_000 };
  const ack = (operationId: string): BreakoutAcknowledgement => ({
    operationId,
    authoritativeRecordId: `controlled-row:${operationId}`,
    receivedAt: at,
    receiptStatus: "QUALIFIED",
  });
  const confirmed = <T>(operationId: string, value: T): BreakoutDurableResult<T> => ({
    status: "confirmed",
    value,
    acknowledgement: ack(operationId),
  });
  const rejected = <T>(operationId: string, code: string): BreakoutDurableResult<T> => ({
    status: "rolled_back",
    code,
    acknowledgement: ack(operationId),
  });
  const account = (role: BreakoutFinancialRole) => state.accounts.find((a) => a.role === role)!;
  const reserved = new Map<string, BreakoutReservedHead>();
  const repository: BreakoutScreenRepository = {
    async guard() {
      calls.push("guard");
    },
    async hasDiscoveryOperation(_scope, _lease, operationId) {
      return state.discoveries.some((d) => d.initialOperationId === operationId);
    },
    async snapshot() {
      return structuredClone(state);
    },
    async commitDiscovery(_scope, _lease, input) {
      calls.push("discovery");
      assert.equal(state.accounts.flatMap((a) => a.view.attempts).length, 0);
      state.discoveries = [...state.discoveries, ...structuredClone(input.discoveries)];
      return confirmed(input.operationId, input.discoveries);
    },
    async latchCloses(_scope, _lease, obligations) {
      for (const obligation of obligations) {
        const old = state.closeObligations.find((o) => o.id === obligation.id);
        if (!old) {
          state.closeObligations = [...state.closeObligations, obligation];
        } else if (old.state !== "CONFIRMED") {
          state.closeObligations = state.closeObligations.map((o) =>
            o.id === old.id
              ? {
                  ...o,
                  reasons: [...new Set([...o.reasons, ...obligation.reasons])],
                  state: obligation.state,
                }
              : o,
          );
        }
      }
      return confirmed("latches", state.closeObligations);
    },
    async reconcileSelective(_scope, _lease, input) {
      for (const entry of state.accounts) {
        const current = state.closeObligations.filter(
          (obligation) => obligation.role === entry.role && obligation.state !== "CONFIRMED",
        );
        const mandatory = current.some((obligation) =>
          obligation.reasons.some((reason) => reason !== "SELECTIVE_EXPOSURE"),
        );
        const marked = applyPaperMarks(entry.view.account, input.observation.frames, at);
        const plan = selectiveReduction(marked, input.observation.frames, at);
        if (!mandatory && plan.status === "pending") {
          continue;
        }
        state.closeObligations = state.closeObligations.filter((obligation) => {
          const obsolete =
            obligation.role === entry.role &&
            obligation.state !== "CONFIRMED" &&
            obligation.reasons.length === 1 &&
            obligation.reasons[0] === "SELECTIVE_EXPOSURE" &&
            (mandatory || !plan.symbols.includes(obligation.symbol));
          if (obsolete) {
            calls.push(`retire-selective:${entry.role}:${obligation.marketId}`);
          }
          return !obsolete;
        });
      }
      return confirmed(input.operationId, undefined);
    },
    async reserveHead(_scope, _lease, discovery) {
      calls.push(`reserve:${discovery.role}:${discovery.marketId}`);
      if (discovery.role === "C") {
        if (
          (mode === "reserve-persistence" && discovery.marketId === 1) ||
          (mode === "later-reserve-persistence" && discovery.marketId === 20)
        ) {
          return rejected(discovery.attemptId, "PERSISTENCE_FAILED");
        }
        if (mode === "reserve-risk" && discovery.marketId === 1) {
          return rejected(discovery.attemptId, "RISK_REJECTED");
        }
        if (mode === "reserve-lease-lost" && discovery.marketId === 1) {
          return rejected(discovery.attemptId, "LEASE_LOST");
        }
      }
      const native = account(discovery.role).view;
      const intent = breakoutOpeningIntent(discovery);
      const risk = paperRisk(native.account, native.attempts, at, intent);
      if (!risk.allowed || native.attempts.some((a) => a.key === discovery.attemptId)) {
        return rejected(discovery.attemptId, "RISK_REJECTED");
      }
      assert.equal(native.attempts.filter((a) => a.status === "pending").length, 0);
      const attempt = {
        key: discovery.attemptId,
        intent,
        status: "pending" as const,
        reserved: "101",
        createdAt: at,
        finishedAt: null,
        reason: null,
        evidence: null,
      };
      native.attempts.push(attempt);
      const head = {
        discovery,
        attempt,
        lease: { key: attempt.key, owner: `owner:${attempt.key}`, expiresAt: at + 60000 },
      };
      reserved.set(attempt.key, head);
      return confirmed(discovery.attemptId, structuredClone(head));
    },
    async executeHead(_scope, _lease, input) {
      calls.push(`execute:${input.head.discovery.role}:${input.head.discovery.marketId}`);
      const role = input.head.discovery.role;
      const native = account(role).view;
      assert.ok(state.discoveries.some((d) => d.episodeKey === input.head.discovery.episodeKey));
      assert.equal(native.attempts.filter((a) => a.status === "pending").length, 1);
      if (mode === "execute-persistence" && role === "C") {
        return rejected(input.head.attempt.key, "PERSISTENCE_FAILED");
      }
      if (mode === "execute-permission" && role === "C") {
        return rejected(input.head.attempt.key, "FORBIDDEN");
      }
      if (mode === "unknown" && role === "C") {
        at += 1000;
        return {
          status: "unknown",
          code: "COMMIT_ACK_LOST",
          operationId: input.head.attempt.key,
          affectedRoles: [role],
        };
      }
      if ((mode === "rollback" || mode === "reject-unknown") && role === "C") {
        return rejected(input.head.attempt.key, "STALE_MARKET_DATA");
      }
      try {
        const admitted = assertBreakoutHead({
          account: native.account,
          attempts: native.attempts,
          head: input.head,
          authoritativeLease: reserved.get(input.head.attempt.key)!.lease,
          finalSet: input.finalSet,
          financialAt: at,
          receiptAt: at,
          digest: breakoutDigest,
          config: breakoutConfig(),
        });
        native.account = admitted.result.account;
        native.movements.push(...admitted.result.movements);
        Object.assign(
          native.attempts.find((a) => a.key === input.head.attempt.key)!,
          { status: "filled", reserved: "0", finishedAt: at },
        );
        if (mode === "late") {
          at = breakoutT0 + 300005;
        }
        if (mode === "age-copy" && role === "C" && input.head.discovery.marketId === 1) {
          at += 6000;
        }
        const outcome = confirmed(input.head.attempt.key, structuredClone(native));
        if (mode === "v-unproved" && outcome.status === "confirmed") {
          outcome.acknowledgement.receiptStatus = "KNOWN_EFFECT_V_UNPROVED";
        }
        return outcome;
      } catch (error) {
        if (!(error instanceof PilotError)) {
          throw error;
        }
        return rejected(input.head.attempt.key, error.code);
      }
    },
    async rejectHead(_scope, _lease, input) {
      calls.push(`reject:${input.head.discovery.role}:${input.head.discovery.marketId}`);
      if (mode === "reject-unknown") {
        return {
          status: "unknown",
          code: "REJECTION_ACK_LOST",
          operationId: input.head.attempt.key,
          affectedRoles: [input.head.discovery.role],
        };
      }
      const native = account(input.head.discovery.role).view;
      Object.assign(
        native.attempts.find((a) => a.key === input.head.attempt.key)!,
        { status: "rejected", reserved: "0", finishedAt: at },
      );
      return confirmed(input.head.attempt.key, structuredClone(native));
    },
    async close(_scope, _lease, input) {
      calls.push(`close:${input.obligation.role}:${input.obligation.marketId}`);
      if (mode === "close-persistence" && input.obligation.role === "C") {
        return rejected(input.obligation.id, "PERSISTENCE_FAILED");
      }
      const native = account(input.obligation.role).view;
      const intent = {
        kind: "close" as const,
        symbol: input.obligation.symbol,
        side: input.obligation.side,
        notional: "0",
        feeReserve: "0",
      };
      const risk = paperRisk(native.account, native.attempts, at, intent);
      if (!risk.allowed) {
        return rejected(input.obligation.id, risk.reasons.join(","));
      }
      const frame = input.finalSet.frames.find(
        (f) => f.snapshot.market.marketId === input.obligation.marketId,
      )!;
      const attempt = {
        key: input.obligation.id,
        intent,
        status: "pending" as const,
        reserved: "0",
        createdAt: at,
        finishedAt: null,
        reason: null,
        evidence: null,
      };
      const result = applyPaperFill(
        native.account,
        attempt,
        simulatePerpsFill(native.account, intent, frame, at),
        at,
      );
      native.account = result.account;
      native.movements.push(...result.movements);
      state.closeObligations = state.closeObligations.map((o) =>
        o.id === input.obligation.id ? { ...o, state: "CONFIRMED" } : o,
      );
      state.closedFences = [
        ...state.closedFences,
        {
          role: input.obligation.role,
          symbol: input.obligation.symbol,
          originatingAt: input.obligation.detectedAt,
          confirmedAt: at,
        },
      ];
      return confirmed(input.obligation.id, structuredClone(native));
    },
    async observe(_scope, _lease, input) {
      calls.push(`observe:${input.roles.join("")}`);
      if (mode === "defer-invalid-mark") {
        return confirmed(input.operationId, structuredClone(state.accounts));
      }
      for (const role of input.roles) {
        const native = account(role).view;
        const next = applyPaperObservation(
          native.account,
          native.movements,
          input.observation,
          input.operationId,
          at,
        );
        native.account = next.account;
        native.movements.push(...next.movements);
      }
      return confirmed(input.operationId, structuredClone(state.accounts));
    },
    async closeAdmissions() {
      calls.push("close-admissions");
      for (const value of state.accounts) {
        value.view.account.admissionsClosed = true;
      }
      return confirmed("admissions-closed", undefined);
    },
    async recordBarrier(_scope, _lease, barrier) {
      state.unknownBarriers = [...state.unknownBarriers, barrier];
    },
    async event(_scope, _lease, key) {
      calls.push(`event:${key}`);
    },
  };
  const coordinator = createHourlyBreakoutCoordinator({
    config: breakoutConfig(),
    acceptance: accepted,
    repository,
    lease,
    clock: () => at,
    receiptClock: () => at,
    digest: breakoutDigest,
    async finalEvidence(request): Promise<BreakoutFinalSet> {
      calls.push("final-source");
      finalCalls++;
      at += 1000;
      const frames = request.initial.observation.frames.map((f) =>
        breakoutFrame(f.snapshot.market.marketId, at),
      );
      if (mode === "selective-then-age") {
        frames.forEach(markTripled);
      }
      return {
        operationId: request.operationId,
        initialOperationId: request.initial.operationId,
        H: Math.floor(request.initial.scheduledAt / 3600000) * 3600000,
        financialAt: at,
        receiptAt: at,
        sourceDeadlineAt: at + 20000,
        frames,
        windows: request.initial.markets.flatMap((m) => (m.window ? [m.window] : [])),
        observation: { frames, funding: [], marksOnly: true },
        smaEvidence: { ...request.initial.smaEvidence, observedAt: at, frames },
      };
    },
  });
  return {
    state,
    calls,
    initial,
    coordinator,
    account,
    get finalCalls() {
      return finalCalls;
    },
    setAt(value: number) {
      at = value;
    },
  };
}

test("an operation evicted from recent memory never receives a new observation or final copy", async () => {
  const fixture = controlled();
  const signal = new AbortController().signal;
  const original = { ...fixture.initial, operationId: "old-original-observation" };
  await fixture.coordinator.maintenance(original, signal);
  for (let index = 0; index < 140; index++) {
    await fixture.coordinator.maintenance(
      { ...fixture.initial, operationId: `later-observation:${index}` },
      signal,
    );
  }
  const observations = fixture.calls.filter((call) => call.startsWith("observe:")).length;
  const finalCopies = fixture.finalCalls;

  await assert.rejects(fixture.coordinator.maintenance(original, signal), {
    code: "OPERATION_TOMBSTONE_PROOF_UNAVAILABLE",
  });

  assert.equal(fixture.calls.filter((call) => call.startsWith("observe:")).length, observations);
  assert.equal(fixture.finalCalls, finalCopies);
});

test("identity failure during due-exit marking cannot become an availability-only omission", async () => {
  const fixture = controlled("defer-invalid-mark");
  const initial = structuredClone(fixture.initial);
  initial.observation.frames[0]!.book.market.marketId = 999;

  await assert.rejects(fixture.coordinator.maintenance(initial, new AbortController().signal), {
    code: "INVALID_MARKET_DATA",
  });

  assert.equal(fixture.finalCalls, 0);
  assert.equal(
    fixture.calls.some((call) => call.startsWith("reserve:")),
    false,
  );
});

test("serial queue reserves one native head, commits discovery first and shares one original final set", async () => {
  const fixture = controlled();
  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(result.status, "COMPLETE");
  assert.equal(fixture.finalCalls, 1);
  assert.equal(fixture.state.discoveries.length, 4);
  assert.equal(fixture.account("C").view.account.positions.length, 2);
  assert.equal(fixture.account("L").view.account.positions.length, 2);
  assert.equal(fixture.account("S").view.account.positions.length, 0);
  assert.ok(fixture.calls.indexOf("discovery") < fixture.calls.indexOf("reserve:C:1"));
  assert.ok(fixture.calls.indexOf("execute:C:1") < fixture.calls.indexOf("reserve:C:20"));
  assert.ok(fixture.state.discoveries.every((d) => d.reserved === "0"));
  assert.ok(fixture.state.accounts.every((a) => a.view.attempts.every((v) => v.reserved === "0")));
  const again = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(again.status, "NO_NEW_DECISION");
  assert.equal(fixture.finalCalls, 1);
});

test("proved final rollback preserves consumed events and releases only through separate confirmed rejection", async () => {
  const fixture = controlled("rollback");
  await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(fixture.finalCalls, 1);
  assert.equal(fixture.account("C").view.account.positions.length, 0);
  assert.equal(fixture.account("C").view.attempts.length, 2);
  assert.ok(
    fixture.account("C").view.attempts.every((a) => a.status === "rejected" && a.reserved === "0"),
  );
  assert.equal(fixture.state.discoveries.filter((d) => d.role === "C").length, 2);
  assert.equal(fixture.calls.filter((c) => c === "reserve:C:1").length, 1);
  await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(fixture.calls.filter((c) => c === "execute:C:1").length, 1);
});

for (const mode of ["reserve-persistence", "execute-persistence", "execute-permission"] as const) {
  test(`${mode} stops all later new admissions immediately after the proved rollback`, async () => {
    const fixture = controlled(mode);

    const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);

    assert.equal(result.status, "ADMISSIONS_STOPPED");
    assert.equal(result.unknown, false);
    assert.ok(
      result.technicalFailures.includes(
        mode === "execute-permission" ? "FORBIDDEN" : "PERSISTENCE_FAILED",
      ),
    );
    assert.equal(fixture.calls.includes("reserve:C:20"), false);
    assert.equal(fixture.calls.includes("reserve:L:1"), false);
    assert.ok(fixture.state.accounts.every((a) => a.view.account.positions.length === 0));
    assert.ok(
      fixture.state.accounts.every((a) => a.view.attempts.every((p) => p.reserved === "0")),
    );
    if (mode !== "reserve-persistence") {
      assert.equal(fixture.calls.filter((call) => call === "reject:C:1").length, 1);
    }
  });
}

test("a later reservation's technical rollback preserves earlier fills and stops all later accounts", async () => {
  const fixture = controlled("later-reserve-persistence");

  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);

  assert.equal(result.status, "ADMISSIONS_STOPPED");
  assert.ok(result.technicalFailures.includes("PERSISTENCE_FAILED"));
  assert.equal(fixture.account("C").view.account.positions.length, 1);
  assert.equal(fixture.calls.includes("reserve:L:1"), false);
});

test("an ordinary risk rejection remains account-local", async () => {
  const fixture = controlled("reserve-risk");

  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);

  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.technicalFailures, []);
  assert.equal(fixture.account("L").view.account.positions.length, 2);
  assert.equal(fixture.calls.includes("execute:C:1"), false);
});

test("lost ownership reported by reservation rollback permits no later source or write", async () => {
  const fixture = controlled("reserve-lease-lost");

  await assert.rejects(fixture.coordinator.cycle(fixture.initial, new AbortController().signal), {
    code: "LEASE_LOST",
  });

  assert.equal(fixture.calls.at(-1), "reserve:C:1");
  assert.equal(fixture.finalCalls, 0);
});

for (const mode of ["unknown", "reject-unknown"] as const) {
  test(`${mode} preserves original reservation and stops every new admission without inventing flatness`, async () => {
    const fixture = controlled(mode);
    const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
    assert.equal(result.status, "ADMISSIONS_STOPPED");
    assert.equal(result.unknown, true);
    assert.equal(fixture.account("C").view.attempts[0]!.reserved, "101");
    assert.equal(fixture.account("C").view.attempts[0]!.status, "pending");
    assert.equal(fixture.calls.includes("reserve:C:20"), false);
    assert.equal(fixture.calls.includes("reserve:L:1"), false);
    const maintenance = breakoutInitial(breakoutT0 + 60000);
    fixture.setAt(maintenance.D);
    await fixture.coordinator.maintenance(maintenance, new AbortController().signal);
    assert.ok(fixture.calls.includes("observe:SL"));
    assert.equal(fixture.account("C").view.attempts[0]!.reserved, "101");
  });
}

test("late confirmed fill remains an actual position and is labeled unresolved commit time", async () => {
  const fixture = controlled("late");
  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(result.status, "ADMISSIONS_STOPPED");
  assert.ok(result.technicalFailures.includes("LATE_ACK_WITH_COMMIT_TIME_UNRESOLVED"));
  assert.equal(fixture.account("C").view.account.positions.length, 1);
  assert.equal(fixture.calls.includes("reserve:C:20"), false);
});

function holdEth(
  fixture: ReturnType<typeof controlled>,
  role: "C" | "L",
  millisecondsUntilAge: number,
) {
  const native = fixture.account(role).view;
  const intent = {
    kind: "open" as const,
    symbol: "ETH",
    side: "long" as const,
    notional: "100",
    feeReserve: "1",
  };
  const attempt = {
    key: `held-original:${role}`,
    intent,
    status: "pending" as const,
    reserved: "101",
    createdAt: fixture.initial.D,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const fill = simulatePerpsFill(
    native.account,
    intent,
    breakoutFrame(20, fixture.initial.D),
    fixture.initial.D,
  );
  const next = applyPaperFill(native.account, attempt, fill, fixture.initial.D);
  native.account = next.account;
  native.movements.push(...next.movements);
  native.account.positions[0]!.openedAt = fixture.initial.D - 4 * 3600000 + millisecondsUntilAge;
}

test("new due close rejects a known unexecuted original head before full reduction and never re-arms it", async () => {
  const fixture = controlled();
  holdEth(fixture, "C", 500);
  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.ok(fixture.calls.indexOf("reject:C:1") < fixture.calls.indexOf("close:C:20"));
  assert.equal(fixture.calls.includes("execute:C:1"), false);
  assert.equal(fixture.calls.filter((c) => c === "reserve:C:1").length, 1);
  assert.equal(fixture.account("C").view.account.positions[0]!.closedAt !== null, true);
  const heldEvent = result.discoveries.find((d) => d.role === "C" && d.marketId === 20)!;
  assert.equal(heldEvent.state, "INITIAL_BLOCKED");
  assert.ok(heldEvent.initialBlockReasons.includes("POSITION_EXISTS"));
  assert.equal(fixture.finalCalls, 1);
});

test("a required close's technical rollback stops new admissions but retains its liability", async () => {
  const fixture = controlled("close-persistence");
  holdEth(fixture, "C", 500);

  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);

  assert.equal(result.status, "ADMISSIONS_STOPPED");
  assert.ok(result.technicalFailures.includes("PERSISTENCE_FAILED"));
  assert.equal(fixture.calls.includes("reserve:L:1"), false);
  assert.equal(fixture.account("C").view.account.positions[0]!.closedAt, null);
  assert.ok(fixture.state.closeObligations.some((obligation) => obligation.state !== "CONFIRMED"));
});

test("a newly mandatory close supersedes an earlier selective-only plan before any unnecessary fill", async () => {
  const fixture = controlled("selective-then-age");
  const native = fixture.account("C").view;
  for (const marketId of [1, 10, 20]) {
    const frame = breakoutFrame(marketId, fixture.initial.D);
    const intent = {
      kind: "open" as const,
      symbol: frame.snapshot.market.symbol,
      side: "long" as const,
      notional: "100",
      feeReserve: "1",
    };
    const attempt = {
      key: `original-held:${marketId}`,
      intent,
      status: "pending" as const,
      reserved: "101",
      createdAt: fixture.initial.D,
      finishedAt: null,
      reason: null,
      evidence: null,
    };
    const applied = applyPaperFill(
      native.account,
      attempt,
      simulatePerpsFill(native.account, intent, frame, fixture.initial.D),
      fixture.initial.D,
    );
    native.account = applied.account;
    native.movements.push(...applied.movements);
    const position = native.account.positions.find((p) => p.symbol === intent.symbol)!;
    position.openedAt = fixture.initial.D - (marketId === 20 ? 4 * 3_600_000 - 500 : 60_000);
  }

  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);

  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(
    fixture.calls.filter((call) => call.startsWith("close:C:")),
    ["close:C:20"],
  );
  assert.ok(fixture.calls.includes("retire-selective:C:1"));
  assert.equal(native.account.positions.filter((p) => p.closedAt === null).length, 2);
  assert.ok(
    fixture.state.closeObligations.every(
      (obligation) => obligation.role !== "C" || obligation.state === "CONFIRMED",
    ),
  );
  const close = fixture.state.closeObligations.find((obligation) => obligation.role === "C")!;
  assert.ok(close.reasons.includes("AGE_4_HOURS"));
  assert.equal(close.marketId, 20);
});

test("unknown opening blocks affected-account due close but permits a different account's authorized full reduction", async () => {
  const fixture = controlled("unknown");
  holdEth(fixture, "C", 1500);
  holdEth(fixture, "L", 1500);
  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(result.unknown, true);
  assert.equal(fixture.calls.includes("close:C:20"), false);
  assert.equal(fixture.calls.includes("reject:C:1"), false);
  assert.equal(fixture.calls.includes("close:L:20"), true);
  assert.equal(fixture.account("C").view.account.positions[0]!.closedAt, null);
  assert.ok(
    fixture.state.closeObligations.some(
      (o) => o.role === "C" && o.symbol === "ETH" && o.state === "BLOCKED_UNKNOWN",
    ),
  );
  assert.equal(fixture.account("L").view.account.positions[0]!.closedAt !== null, true);
});

test("an aged original shared final copy cannot be refreshed to rescue queued later heads", async () => {
  const fixture = controlled("age-copy");
  await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(fixture.finalCalls, 1);
  assert.equal(fixture.account("C").view.account.positions.length, 1);
  assert.equal(fixture.account("C").view.attempts[1]!.status, "rejected");
  assert.equal(fixture.calls.filter((c) => c === "execute:C:20").length, 1);
  assert.equal(fixture.state.discoveries.filter((d) => d.role === "C").length, 2);
});

test("known committed effect with missing V proof stops admission without becoming financial uncertainty", async () => {
  const fixture = controlled("v-unproved");
  const result = await fixture.coordinator.cycle(fixture.initial, new AbortController().signal);
  assert.equal(result.status, "ADMISSIONS_STOPPED");
  assert.equal(result.unknown, false);
  assert.ok(result.technicalFailures.includes("GAP_COMPLIANCE_UNPROVED"));
  assert.equal(fixture.state.unknownBarriers.length, 0);
  assert.equal(fixture.account("C").view.account.positions.length, 1);
  assert.equal(fixture.account("C").view.attempts[0]!.status, "filled");
  assert.equal(fixture.account("C").view.attempts[0]!.reserved, "0");
  assert.equal(fixture.calls.includes("reserve:C:20"), false);
});

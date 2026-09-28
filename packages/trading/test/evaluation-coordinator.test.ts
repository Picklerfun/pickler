import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvaluationCoordinator,
  EVALUATION_PROTOCOLS,
  type EvaluationRequest,
} from "@pickler/trading/evaluation";

function request(overrides: Partial<EvaluationRequest> = {}): EvaluationRequest {
  return {
    command: "run",
    configuration: { protocol: "perps-comparison-v1", version: 1 },
    allowPaid: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}
test("evaluation admission rejects paid work before invoking either adapter", async () => {
  let calls = 0;
  const adapter = {
    async execute() {
      calls++;
    },
  };
  const coordinator = createEvaluationCoordinator({
    "perps-comparison-v1": adapter,
    "btc-decision-benchmark-v1": adapter,
  });
  for (const [protocol, definition] of Object.entries(EVALUATION_PROTOCOLS)) {
    for (const command of definition.paidCommands) {
      await assert.rejects(
        coordinator.execute(
          request({
            configuration: {
              protocol: protocol as EvaluationRequest["configuration"]["protocol"],
              version: definition.version,
            },
            command,
          }),
        ),
        { code: "PAID_OPT_IN_REQUIRED" },
      );
    }
  }
  assert.equal(calls, 0);
});
test("coordinator retains request identity, cancellation, and protocol-specific accounting", async () => {
  const original = request({ command: "report" });
  const coordinator = createEvaluationCoordinator({
    "perps-comparison-v1": {
      async execute(received) {
        assert.equal(received, original);
        return "historical";
      },
    },
  });
  assert.equal(await coordinator.execute(original), "historical");
  assert.notEqual(
    EVALUATION_PROTOCOLS["perps-comparison-v1"].accounting,
    EVALUATION_PROTOCOLS["btc-decision-benchmark-v1"].accounting,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(coordinator.execute(request({ signal: controller.signal })), {
    name: "AbortError",
  });
});
test("unknown versions and unsupported commands cannot fall through to another protocol", async () => {
  const coordinator = createEvaluationCoordinator({});
  await assert.rejects(
    coordinator.execute(
      request({ configuration: { protocol: "perps-comparison-v1", version: 4 } }),
    ),
    { code: "EVALUATION_PROTOCOL_INVALID" },
  );
  await assert.rejects(coordinator.execute(request({ command: "validate" })), {
    code: "EVALUATION_COMMAND_INVALID",
  });
  await assert.rejects(coordinator.execute(request({ command: "report" })), {
    code: "EVALUATION_ADAPTER_MISSING",
  });
});

test("historical protocols reject new work even with paid opt-in", async () => {
  for (const [protocol, version] of [
    ["paper-study-v1", 1],
    ["btc-quant-jev-v1", 2],
    ["btc-policy-comparison-v1", 3],
  ] as const) {
    const coordinator = createEvaluationCoordinator({});
    for (const command of ["prepare", "run", "validate"] as const) {
      await assert.rejects(
        coordinator.execute(
          request({ configuration: { protocol, version }, command, allowPaid: true }),
        ),
        { code: "EVALUATION_COMMAND_INVALID" },
      );
    }
  }
});

test("core exports no duplicate trading implementation", async () => {
  const core = await import("@pickler/core");
  for (const name of [
    "createTradingService",
    "createPerpsPaperService",
    "simulatePaperBuy",
    "paperRisk",
    "createEvaluationCoordinator",
  ]) {
    assert.equal(name in core, false, name);
  }
});

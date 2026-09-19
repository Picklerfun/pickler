import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_NAMES } from "@pickler/core";
import { modelDiagnostic } from "../src/composition/model-diagnostics";

test("all reviewed tools including optional sports plugins are recognized, unknown names redacted", () => {
  for (const name of [...TOOL_NAMES, "connectionProbe", "secret-name"]) {
    const diagnostic = modelDiagnostic("research", 1, {
      toolCalls: [{ payload: { toolName: name, toolCallId: "1", args: { secret: "value" } } }],
      toolResults: [{ payload: { toolCallId: "1", result: { secret: "value" } } }],
    });
    assert.deepEqual(diagnostic.tools, [
      { name: name === "secret-name" ? "unknown" : name, status: "completed" },
    ]);
    assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
  }
});

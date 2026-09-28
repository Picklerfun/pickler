import assert from "node:assert/strict";
import test from "node:test";
import { PLUGIN_IDS, PLUGINS } from "@pickler/core";
import { pluginFactories, plugins, buildTools } from "@pickler/agent-runtime/plugins/registry";
test("each catalog identity has one factory and metadata is not redefined", () => {
  assert.deepEqual(Object.keys(pluginFactories).sort(), [...PLUGIN_IDS].sort());
  for (const descriptor of PLUGINS) {
    const runtime = plugins.find((p) => p.id === descriptor.id)!;
    const { connectionCheck, ...metadata } = runtime;
    assert.deepEqual(metadata, descriptor);
    assert.equal(connectionCheck, `/agents/:id/plugins/${descriptor.id}/check`);
  }
});
test("execution factories expose no model tools and disabled reads remain absent", () => {
  assert.deepEqual(Object.keys(buildTools({})), []);
  for (const id of ["paper-trading", "polymarket-trading", "perps-paper"] as const) {
    assert.equal("buildResearchTools" in pluginFactories[id], false);
  }
  const tools = buildTools({
    getSportsContext: async () => ({ status: "available", sources: [] }),
  });
  assert.deepEqual(Object.keys(tools), ["getSportsContext"]);
});

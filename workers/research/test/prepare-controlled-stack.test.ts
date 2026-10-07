import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("fresh controlled stacks start before application schemas exist", async () => {
  const script = fileURLToPath(new URL("./prepare-controlled-stack.mjs", import.meta.url));
  const directory = execFileSync(process.execPath, [script, "prepare"], {
    encoding: "utf8",
  }).trim();
  try {
    const config = await readFile(join(directory, "supabase/config.toml"), "utf8");
    const marker = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
    assert.match(config, /^schemas = \["public", "graphql_public"\]$/m);
    assert.match(config, /^port = 55522$/m);
    assert.match(config, /^port = 55521$/m);
    assert.ok(config.includes(`project_id = "${marker.project}"`));
    assert.match(marker.project, /^pickler-workers-[a-f0-9]{8}$/);
    assert.match(marker.identity, /^[a-f0-9-]{36}$/);
  } finally {
    // This test only created configuration files; it never starts a container or a Git worktree.
    await rm(directory, { recursive: true });
  }
});

test("alternate fixed port slot preserves an existing controlled stack", async () => {
  const script = fileURLToPath(new URL("./prepare-controlled-stack.mjs", import.meta.url));
  const directory = execFileSync(process.execPath, [script, "prepare", "alternate"], {
    encoding: "utf8",
  }).trim();
  try {
    const config = await readFile(join(directory, "supabase/config.toml"), "utf8");
    const marker = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
    assert.equal(marker.portSlot, 3);
    assert.match(config, /^port = 55532$/m);
    assert.match(config, /^port = 55531$/m);
  } finally {
    await rm(directory, { recursive: true });
  }
});

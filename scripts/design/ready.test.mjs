import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { observeClient, ready, saveBlocked, READY_MS } from "./lib/ready.mjs";

function controlledPage(waitFor) {
  const page = new EventEmitter();
  page.locator = (selector) => ({
    first: () => ({ waitFor: (options) => waitFor(selector, options) }),
  });
  page.url = () => "http://localhost:3001/studio?stage=create-avatar";
  page.screenshot = async () => {};
  return page;
}

test("the exact proof waits for attachment with a bounded default", async () => {
  let attach;
  const attachment = new Promise((resolve) => {
    attach = resolve;
  });
  const page = controlledPage((selector, options) => {
    assert.equal(selector, "#new-agent-avatar[open]");
    assert.deepEqual(options, { state: "attached", timeout: 10_000 });
    return attachment;
  });
  const client = observeClient(page);
  let finished = false;
  const waiting = ready(page, "#new-agent-avatar[open]", client).then((value) => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  attach();
  assert.equal(await waiting, null);
  assert.equal(READY_MS, 10_000);
  client.dispose();
});

test("missing proof is a failure with local diagnostic evidence", async () => {
  const page = controlledPage(async () => {
    throw new Error("Timeout");
  });
  const client = observeClient(page);
  const detail = await ready(page, "#new-agent-avatar[open]", client, 20);
  assert.match(detail, /did not appear within 20ms/);
  const directory = mkdtempSync(path.join(tmpdir(), "pickler-ready-"));
  try {
    const file = await saveBlocked(
      page,
      { name: "avatar", path: "/studio", proves: "#new-agent-avatar[open]" },
      client,
      detail,
      directory,
    );
    const record = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(record.url, page.url());
    assert.equal(record.selector, "#new-agent-avatar[open]");
    assert.deepEqual(record.clientErrors, []);
    assert.ok(record.screenshot.endsWith(".png"));
  } finally {
    client.dispose();
    rmSync(directory, { recursive: true });
  }
});

test("a client throw fails even when the proof exists and records the error", async () => {
  const page = controlledPage(async () => {});
  const client = observeClient(page);
  page.emit("pageerror", new Error("Controlled hydration failure"));
  const detail = await ready(page, "#proof", client);
  assert.match(detail, /client error: Controlled hydration failure/);
  const directory = mkdtempSync(path.join(tmpdir(), "pickler-ready-"));
  try {
    const file = await saveBlocked(
      page,
      { name: "throw", path: "/studio", proves: "#proof" },
      client,
      detail,
      directory,
    );
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).clientErrors, [
      "Controlled hydration failure",
    ]);
  } finally {
    client.dispose();
    rmSync(directory, { recursive: true });
  }
  assert.equal(page.listenerCount("pageerror"), 0);
});

test("diagnostics never capture a deployed account", async () => {
  const page = controlledPage(async () => {});
  page.url = () => "https://app.pickler.fun/account";
  const client = observeClient(page);
  const directory = mkdtempSync(path.join(tmpdir(), "pickler-ready-"));
  try {
    assert.equal(await saveBlocked(page, { name: "account" }, client, "blocked", directory), null);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    client.dispose();
    rmSync(directory, { recursive: true });
  }
});

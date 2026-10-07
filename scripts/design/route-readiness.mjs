/** Cold and delayed hydration acceptance. Local preview and synthetic failures only. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { observeClient, ready, saveBlocked } from "./lib/ready.mjs";
import { BASE_URL, listening, start } from "./lib/servers.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const diagnostics = path.join(root, "scripts/design/.shots/diagnostics");
mkdirSync(diagnostics, { recursive: true });
assert.equal(await listening(3001), false, "Local web port is already in use");
assert.equal(await listening(8799), false, "Local fixture port is already in use");
const servers = await start(root, path.join(diagnostics, "readiness-servers.log"));
let browser;
try {
  browser = await openBrowser();
  for (const slow of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const client = observeClient(page);
    let release;
    const scriptsAllowed = new Promise((resolve) => {
      release = resolve;
    });
    if (slow) {
      await context.route("**/*", async (route) => {
        if (route.request().resourceType() === "script") {
          await scriptsAllowed;
        }
        return route.continue();
      });
    }
    const route = {
      name: `avatar-${slow ? "slow" : "cold"}`,
      path: "/studio?stage=create-avatar",
      proves: "#new-agent-avatar[open]",
    };
    try {
      await page.goto(`${BASE_URL}${route.path}`, {
        waitUntil: slow ? "domcontentloaded" : "networkidle",
      });
      if (slow) {
        assert.equal(await page.locator(route.proves).count(), 0);
      }
      const waiting = ready(page, route.proves, client);
      release();
      const failure = await waiting;
      if (failure) {
        await saveBlocked(page, route, client, failure);
      }
      assert.equal(failure, null);
      assert.equal(await page.locator(route.proves).isVisible(), true);
      assert.deepEqual(client.errors, []);
      console.log(`${route.name}: opened by React and visible`);
    } finally {
      release();
      client.dispose();
      await context.close();
    }
  }
  // Real browser checks of negative outcomes; expected diagnostics stay outside CI artifacts.
  for (const throws of [false, true]) {
    const page = await browser.newPage();
    const client = observeClient(page);
    await page.route("**/ready-negative", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<main>Controlled missing screen</main>",
      }),
    );
    await page.goto(`${BASE_URL}/ready-negative`);
    const waiting = ready(page, "#absent", client, 1000);
    if (throws) {
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error("Controlled client failure");
        }, 0);
      });
    }
    const failure = await waiting;
    assert.match(failure, throws ? /Controlled client failure/ : /did not appear/);
    const output = mkdtempSync(path.join(tmpdir(), "pickler-ready-negative-"));
    const file = await saveBlocked(
      page,
      { name: "negative", path: "/studio", proves: "#absent" },
      client,
      failure,
      output,
    );
    const record = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(record.selector, "#absent");
    assert.equal(record.clientErrors.length, throws ? 1 : 0);
    client.dispose();
    await page.close();
  }
} finally {
  await browser?.close();
  servers.stop();
}

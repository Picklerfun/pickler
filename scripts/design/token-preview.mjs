/** Local-only token presentation acceptance. No passkeys, providers or transactions. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { start, BASE_URL } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.argv[2] ?? process.env.DESIGN_BASE_URL ?? BASE_URL;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = path.join(root, "scripts/design/.shots/diagnostics/token-preview");
mkdirSync(output, { recursive: true });
let servers;
let browser;
let page;
const errors = [];
const forbidden = [];
try {
  if (!process.argv[2] && !process.env.DESIGN_BASE_URL) {
    servers = await start(root, path.join(output, "servers.log"));
  }
  browser = await openBrowser();
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname.startsWith("/api/")) {
      forbidden.push(url.toString());
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1280, 380]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/studio/agents/preview-live/token?stage=perpl-token-empty`);
    const name = page.getByRole("textbox", { name: "Token name", exact: true });
    await name.waitFor();
    // A real navigation proves hydration and the persistent shell before entering a draft.
    if (width === 1280) {
      await page.locator("#live-rail-identity").click();
      await page.locator("#live-section-identity").waitFor();
      await page.locator("#live-rail-token").click();
    } else {
      await page.getByRole("button", { name: "Review launch", exact: true }).click();
      await page.getByRole("region", { name: "Review token launch" }).waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await name.waitFor();
    await name.fill("My preview token");
    await page.getByRole("textbox", { name: "Ticker", exact: true }).fill("DEMO");
    if (width === 1280) {
      const sidebar = await page.locator("#live-sidebar").elementHandle();
      const header = await page.locator("header").first().elementHandle();
      await page.locator("#live-rail-identity").click();
      await page.locator("#live-section-identity").waitFor();
      await page.locator("#live-rail-token").click();
      assert.equal(await name.inputValue(), "My preview token");
      assert.equal(await sidebar.evaluate((node) => node.isConnected), true);
      assert.equal(await header.evaluate((node) => node.isConnected), true);
    }
    const review = page.getByRole("button", { name: "Review launch", exact: true });
    await review.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("region", { name: "Review token launch" }).waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await name.inputValue(), "My preview token");
    await review.click();
    await page.getByRole("button", { name: "Simulate launch", exact: true }).click();
    await page.getByText("Awaiting signature · simulated", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Simulate failure", exact: true }).click();
    await page
      .getByRole("alert")
      .getByText("Simulated launch failed. Your draft is kept.")
      .waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("button", { name: "Simulate signature", exact: true }).click();
    await page.getByText("Confirming · simulated", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Simulate confirmation", exact: true }).click();
    await page.locator('[data-token-state="launched"]:visible').waitFor();
    await page.getByRole("heading", { name: "My preview token", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Explorer", exact: true }).isDisabled(),
      true,
    );
    await page.screenshot({ path: path.join(output, `simulated-${width}.png`), fullPage: true });

    for (const [suffix, state] of [
      ["/studio/agents/preview-live/token?stage=perpl-token-launched", "launched"],
      ["/agents/halftime?stage=token-empty", "empty"],
      ["/agents/halftime?stage=token-launched", "launched"],
    ]) {
      await page.goto(base + suffix);
      await page.locator(`[data-token-state="${state}"]:visible`).waitFor();
      assert.equal(await page.locator('a[href*="monadexplorer"]').count(), 0);
      if (suffix.startsWith("/agents/")) {
        assert.equal(
          await page.getByRole("button", { name: "Review launch", exact: true }).count(),
          0,
        );
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `No horizontal overflow at ${width}: ${suffix}`,
      );
      await page.screenshot({
        path: path.join(
          output,
          `${state}-${suffix.startsWith("/agents/") ? "public" : "studio"}-${width}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await page.goto(`${base}/studio/agents/preview-draft/token?stage=draft`);
  await page.getByRole("button", { name: "Go public first", exact: true }).waitFor();
  assert.deepEqual(errors, [], "No client exceptions");
  assert.deepEqual(forbidden, [], "Token previews never consult APIs or external providers");
  console.log(
    "Token previews passed: both Studio/public states, private agent, review, keyboard, cancel, failure, retry, confirmation, stable layout and mobile.",
  );
} catch (error) {
  writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ url: page?.url(), errors, forbidden, message: String(error) }, null, 2),
  );
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  servers?.stop();
}

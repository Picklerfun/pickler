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
  for (const width of [1280, 380, 320]) {
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
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByText("Draft saved", { exact: true }).waitFor();
    }
    await name.waitFor();
    if (width === 1280) {
      await page.getByRole("region", { name: "Token launch", exact: true }).screenshot({
        path: path.join(output, "launcher-card.png"),
      });
    }
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
    const details = page.getByRole("region", { name: "Token launch details" });
    await details.getByText("My preview token · $DEMO", { exact: true }).waitFor();
    assert.equal(await details.getByText("21,000,000", { exact: true }).count(), 1);
    assert.equal(await details.getByText("16,800,000 · 80%", { exact: true }).count(), 1);
    assert.equal(await details.getByText("4,200,000 · 20%", { exact: true }).count(), 1);
    assert.equal(
      await details.locator('abbr[title="0x5555555555555555555555555555555555555555"]').count(),
      1,
    );
    await details.getByText("≈10,000", { exact: false }).waitFor();
    await details.getByText("≈160,000", { exact: false }).waitFor();
    await details.getByText("≈32,000", { exact: false }).waitFor();
    assert.equal(await details.getByText("0 AUSD", { exact: true }).count(), 1);
    assert.equal(await details.getByText("Paid separately in MON", { exact: true }).count(), 1);
    assert.equal(await details.getByText("50% / 50%", { exact: true }).count(), 1);
    assert.equal(
      await details
        .getByText("After graduation: 50% creator / 50% Pickler of actual Kuru LP fees.", {
          exact: true,
        })
        .count(),
      1,
    );
    assert.equal(await details.getByText("Creator share of LP fees", { exact: true }).count(), 0);
    const allocationTrack = await details.locator(".pk-meter").boundingBox();
    const curveFill = await details.locator(".pk-meter-fill").boundingBox();
    assert.ok(allocationTrack && curveFill);
    assert.ok(Math.abs(curveFill.width / allocationTrack.width - 0.8) < 0.01);
    assert.equal(await page.getByRole("button", { name: /Simulate|Review launch/ }).count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Launch token", exact: true }).isDisabled(),
      true,
    );
    const save = page.getByRole("button", { name: "Save draft", exact: true });
    await save.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Draft saved", { exact: true }).waitFor();
    assert.equal(await name.inputValue(), "My preview token");
    const operations = page.getByRole("region", { name: "Token operations", exact: true });
    await operations.getByRole("button", { name: "Launch token", exact: true }).click();
    await operations.getByText("Awaiting signature", { exact: true }).waitFor();
    assert.equal(await name.inputValue(), "My preview token");
    const cancel = operations.getByRole("button", { name: "Cancel", exact: true });
    await cancel.focus();
    await page.keyboard.press("Enter");
    await operations.getByText("Cancelled", { exact: true }).waitFor();
    await operations.getByRole("button", { name: "Launch token", exact: true }).click();
    await operations.getByRole("button", { name: "Preview failure", exact: true }).click();
    await operations.getByText("Could not complete", { exact: true }).waitFor();
    await operations.getByRole("button", { name: "Launch token", exact: true }).click();
    await operations.getByRole("button", { name: "Continue preview", exact: true }).click();
    await operations.getByText("Confirming", { exact: true }).waitFor();
    await operations.getByRole("button", { name: "Check status", exact: true }).click();
    await page.locator('[data-token-state="launched"]:visible').waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "My preview token", exact: true }).count(),
      1,
    );
    // Start a fresh empty fixture after confirming the controlled operation.
    await page.goto(`${base}/studio/agents/preview-live/token?stage=perpl-token-empty`);
    await name.waitFor();
    await name.fill("Another name");
    await page.getByRole("textbox", { name: "Ticker", exact: true }).fill("DEMO");
    await details.getByText("Another name · $DEMO", { exact: true }).waitFor();
    assert.equal(await details.getByText("21,000,000", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Draft saved", { exact: true }).count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `Inline summary fits ${width}`,
    );
    await page.screenshot({ path: path.join(output, `inline-${width}.png`), fullPage: true });

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
    "Token previews passed: both Studio/public states, fixed 21-million supply, live details, controlled launch/cancel/failure, saved drafts, keyboard, stable layout and mobile.",
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

/** Loopback-only production-market acceptance. Indexed data and failures are controlled. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { networkByChainId } from "@pickler/chain";
import { sampleTokenMarket } from "./fixtures/sample-token-market.mts";
import { openBrowser } from "./lib/browser.mjs";

const base = process.argv[2];
assert.ok(
  base,
  "Supply a running loopback Web URL (use a production build for release acceptance).",
);
const origin = new URL(base);
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".shots/diagnostics/public-token-market",
);
mkdirSync(output, { recursive: true });
const market = sampleTokenMarket();
const detailPath = `/api/v1/launches/${encodeURIComponent(market.data.id)}`;
const errors = [];
const forbidden = [];
let release;
let mode = "loading";
let reads = 0;
const browser = await openBrowser();
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value) => {
          window.__copiedTradeAddress = value;
        },
      },
    });
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin.origin) {
      forbidden.push(url.href);
      return route.abort();
    }
    if (url.pathname === detailPath) {
      assert.equal(route.request().method(), "GET");
      reads++;
      if (mode === "loading") {
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      if (mode === "error") {
        return route.fulfill({ status: 503, json: { error: "CONTROLLED_READ_FAILURE" } });
      }
      if (mode === "invalid") {
        const invalid = structuredClone(market);
        invalid.data.market.realQuoteReserve = "not an amount";
        return route.fulfill({ json: invalid });
      }
      if (mode === "pending") {
        return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
      }
      if (mode === "empty") {
        const empty = structuredClone(market);
        empty.data.market.history = [empty.data.market.history[0]];
        empty.data.market.recentTrades = [];
        return route.fulfill({ json: empty });
      }
      return route.fulfill({ json: market });
    }
    if (url.pathname.startsWith("/api/")) {
      forbidden.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${base}/agents/public_trade`);
  const panel = page.locator('[data-token-market="live"]');
  const price = page.getByRole("region", { name: "Token price and valuation" });
  await panel.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Token price and valuation"]')
        ?.getAttribute("aria-busy") === "true",
  );
  const input = page.getByRole("textbox", { name: "Public amount · AUSD" });
  await input.fill("2");
  assert.ok(release);
  mode = "ready";
  release();
  await price.locator("canvas").first().waitFor();
  assert.equal(await input.inputValue(), "2", "Read completion must preserve the trade form.");
  const observedChart = price.getByRole("img", { name: /24h observed token prices/ });
  await observedChart.focus();
  await observedChart.press("ArrowLeft");
  const tooltip = price.getByRole("tooltip");
  await tooltip.waitFor({ state: "visible" });
  assert.match(await tooltip.innerText(), /AUSD/);
  assert.match(await tooltip.innerText(), /UTC/);
  await observedChart.press("Escape");
  await tooltip.waitFor({ state: "hidden" });
  const chartBox = await observedChart.boundingBox();
  assert.ok(chartBox);
  await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2);
  await tooltip.waitFor({ state: "visible" });
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(tooltipBox);
  assert.ok(
    tooltipBox.x >= chartBox.x && tooltipBox.x + tooltipBox.width <= chartBox.x + chartBox.width,
  );
  await page.mouse.move(0, 0);
  const table = page.getByRole("region", { name: "Recent curve trades" });
  assert.equal(await table.locator("tbody tr").count(), 2);
  await table.getByRole("columnheader", { name: "Wallet", exact: true }).waitFor();
  for (const [index, trade] of market.data.market.recentTrades.entries()) {
    const row = table.locator("tbody tr").nth(index);
    const role = trade.side === "buy" ? "buyer" : "seller";
    const wallet = row.getByRole("link", { name: `View ${role} wallet in explorer` });
    assert.equal(
      await wallet.getAttribute("href"),
      `${networkByChainId(10143).explorers[0]}/address/${trade.trader}`,
    );
    assert.equal(await wallet.getAttribute("title"), trade.trader);
    const copyWallet = row.getByRole("button", { name: `Copy ${role} wallet` });
    assert.equal(await copyWallet.innerText(), "");
    await copyWallet.click();
    await row.getByRole("button", { name: `Copied ${role} wallet` }).waitFor();
    assert.equal(await page.evaluate(() => window.__copiedTradeAddress), trade.trader);
  }
  const tx = table.getByRole("link", { name: "View sell transaction in explorer" });
  assert.equal(
    await tx.getAttribute("href"),
    `${networkByChainId(10143).explorers[0]}/tx/${market.data.market.recentTrades[0].txHash}`,
  );
  assert.equal(await table.getByRole("button", { name: "Copy sell transaction" }).innerText(), "");
  for (const width of [1280, 779, 632, 380, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `market-${width}.png`), fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `Page overflow at ${width}px`,
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await price.getByRole("button", { name: "1H", exact: true }).click();
  await price.getByText("More trades will build the chart").waitFor();
  await price.getByRole("button", { name: "7D", exact: true }).focus();
  await page.keyboard.press("Enter");
  await price.locator("canvas").first().waitFor();
  assert.equal(
    await price.locator(".pk-price-plot").evaluate((element) => element.getAnimations().length),
    0,
    "Reduced motion must disable the plot reveal.",
  );
  assert.equal(
    await panel.evaluate(
      (element) => getComputedStyle(element.querySelector("section")).animationName,
    ),
    "none",
    "Reduced motion must disable panel entrances.",
  );
  await page.getByRole("button", { name: "How the curve works" }).click();
  await page
    .getByText("Buying raises the curve price; selling lowers it.", { exact: false })
    .waitFor();
  const refresh = price.getByRole("button", { name: "Refresh", exact: true });
  const retry = price.getByRole("button", { name: "Retry", exact: true });
  for (const failure of ["error", "invalid"]) {
    mode = failure;
    await refresh.click();
    await retry.waitFor();
    assert.equal(await input.inputValue(), "2");
    await price.locator("canvas").first().waitFor();
    mode = "ready";
    await retry.click();
    await refresh.waitFor();
  }
  mode = "pending";
  await refresh.click();
  await price.getByText("Market data is being indexed. Trading remains available.").waitFor();
  assert.equal(await input.inputValue(), "2");
  mode = "empty";
  await refresh.click();
  await price.getByText("No curve trades recorded yet").waitFor();
  assert.equal(
    await price.locator("canvas").count(),
    0,
    "A launch observation cannot invent a price history.",
  );
  assert.equal(await input.inputValue(), "2");
  assert.ok(reads >= 7);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: normal production route, canonical data, buyer/seller wallet links and copy, hashes, keyboard, 320–1280px, pending/error/retry and trade-form preservation; no providers or transactions.\n",
  );
} finally {
  release?.();
  await browser.close();
}

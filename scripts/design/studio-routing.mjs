/** Route/navigation acceptance uses local fixtures only; product acceptance remains separate. */
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { start, BASE_URL } from "./lib/servers.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.env.DESIGN_BASE_URL ?? BASE_URL;
assert.ok(["localhost", "127.0.0.1", "app.pickler.localhost"].includes(new URL(base).hostname));
const output = path.join(root, "scripts/design/.shots/diagnostics/studio-routing");
let servers;
let browser;
let page;
const errors = [];
const requests = [];
try {
  if (!process.env.DESIGN_BASE_URL) {
    servers = await start(root, path.join(tmpdir(), "pickler-routing-servers.log"));
  }
  browser = await openBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      requests.push(request.url());
    }
  });
  for (const [stage, prefix, agentId, sections] of [
    [
      "draft",
      "draft",
      "preview-draft",
      [
        "overview",
        "console",
        "picks",
        "activity",
        "brief",
        "skills",
        "limits",
        "identity",
        "profile",
        "trade",
        "master",
      ],
    ],
    [
      "perpl-live",
      "live",
      "preview-live",
      [
        "overview",
        "positions",
        "record",
        "decisions",
        "console",
        "posts",
        "brief",
        "skills",
        "limits",
        "controls",
        "identity",
        "agents",
        "markets",
        "leaders",
        "master",
        "account",
      ],
    ],
  ]) {
    await page.goto(`${base}/studio?stage=${stage}`);
    const sidebar = await page.locator(`#${prefix}-sidebar`).elementHandle();
    const header = await page.locator("header").first().elementHandle();
    for (const section of sections) {
      const link = page.locator(`#${prefix}-rail-${section}`);
      await link.waitFor();
      assert.equal(await link.evaluate((node) => node.tagName), "A", "Navigation uses links");
      await link.click();
      await page.waitForURL(`**/studio/agents/${agentId}/${section}?stage=${stage}`);
      await page.waitForFunction(
        ({ prefix, section }) =>
          document.getElementById(`${prefix}-rail-${section}`)?.getAttribute("aria-current") ===
          "page",
        { prefix, section },
      );
      assert.equal(
        await sidebar.evaluate((node) => node.isConnected),
        true,
        "Sidebar stays mounted",
      );
      assert.equal(await header.evaluate((node) => node.isConnected), true, "Navbar stays mounted");
    }
    // Deep entry/reload resolves the exact agent and section independently of navigation state.
    await page.goto(`${base}/studio/agents/${agentId}/brief?stage=${stage}`);
    await page.locator(`#${prefix}-section-brief`).waitFor();
    await page.reload();
    await page.locator(`#${prefix}-section-brief`).waitFor();
  }
  await page.goto(`${base}/studio?stage=live`);
  await page.locator("#home-menu").getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .locator("#home-menu-panel")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.waitForURL(/\/studio\/agents\/[^/]+\/overview\?stage=live$/);
  const historicalAgent = new URL(page.url()).pathname.split("/")[3];
  const historicalRail = await page
    .getByRole("navigation", { name: "Studio sections" })
    .elementHandle();
  for (const section of [
    "overview",
    "context",
    "picks",
    "activity",
    "brief",
    "skills",
    "sources",
    "limits",
    "identity",
    "profile",
    "audience",
    "token",
    "board",
  ]) {
    await page.locator(`a[href="/studio/agents/${historicalAgent}/${section}?stage=live"]`).click();
    await page.waitForURL(`**/studio/agents/${historicalAgent}/${section}?stage=live`);
    assert.equal(
      await historicalRail.evaluate((node) => node.isConnected),
      true,
      "Historical rail stays mounted",
    );
  }
  await page.goto(`${base}/studio/agents/preview-draft/brief?stage=draft`);
  // A completed client navigation proves hydration before editing a controlled input.
  await page.locator("#draft-rail-skills").click();
  await page.waitForURL("**/studio/agents/preview-draft/skills?stage=draft");
  await page.locator("#draft-rail-brief").click();
  await page.waitForURL("**/studio/agents/preview-draft/brief?stage=draft");
  const input = page.locator("#draft-section-brief textarea").first();
  await input.waitFor();
  await input.fill("An unsaved thesis preserved across real routes.");
  const editedThesis = await input.inputValue();
  assert.equal(editedThesis, "An unsaved thesis preserved across real routes.");
  await page.locator("#draft-rail-skills").click();
  await page.locator("#draft-section-skills").waitFor();
  await page.goBack();
  await page.locator("#draft-section-brief").waitFor();
  assert.equal(await input.inputValue(), editedThesis);
  await page.goForward();
  await page.locator("#draft-section-skills").waitFor();
  await page.locator("#draft-rail-brief").click();
  await page.waitForURL("**/studio/agents/preview-draft/brief?stage=draft");
  await page.locator("#draft-section-brief").waitFor();
  assert.equal(await input.inputValue(), editedThesis);
  await page.locator("[data-account-menu] > button").click();
  const profile = page.getByRole("menuitem", { name: "My profile", exact: true });
  const returnTo = new URL(await profile.getAttribute("href"), base).searchParams.get("returnTo");
  assert.equal(new URL(returnTo, base).pathname, "/studio/agents/preview-draft/brief");
  await profile.click();
  await page.getByRole("link", { name: "Back to studio", exact: false }).click();
  await page.waitForURL("**/studio/agents/preview-draft/brief?stage=draft");
  await page.locator("#draft-section-brief").waitFor();
  assert.equal(await input.inputValue(), editedThesis);
  assert.deepEqual(errors, [], "Successful navigation has no React errors");
  assert.equal(
    requests.filter((url) => /\/x\/posts(?:\?|$)/.test(url)).length,
    0,
    "Navigation never fetches X posts",
  );
  await page.screenshot({
    path: path.join(tmpdir(), "pickler-studio-routes-preview.png"),
    fullPage: true,
  });
  console.log(
    "Studio routing passed: all draft/live links, stable chrome, reload, history, form and profile return.",
  );
} catch (error) {
  mkdirSync(output, { recursive: true });
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  }
  writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ url: page?.url(), errors, requests, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  servers?.stop();
}

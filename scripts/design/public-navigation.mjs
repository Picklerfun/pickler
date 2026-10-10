/** Controlled public navigation acceptance. No wallet signatures or external providers. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { start, BASE_URL } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.argv[2] ?? process.env.DESIGN_BASE_URL ?? BASE_URL;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = path.join(root, "scripts/design/.shots/diagnostics/public-navigation");
mkdirSync(output, { recursive: true });
const profile = "/agents/halftime?stage=token-empty";
const errors = [];
const forbidden = [];
let browser;
let servers;
let page;

async function context(options = {}) {
  const result = await browser.newContext(options);
  await result.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      forbidden.push(url.toString());
      return route.abort();
    }
    return route.continue();
  });
  result.on("page", (opened) => opened.on("pageerror", (error) => errors.push(error.message)));
  return result;
}

async function geometry(width) {
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const box = await nav.boundingBox();
  assert.ok(box.height <= 75, `One navbar row at ${width}px: ${box.height}px`);
  const controls = await nav.locator("a, button").evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getClientRects().length)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          label: node.getAttribute("aria-label") ?? node.textContent,
          left: rect.left,
          right: rect.right,
          center: rect.top + rect.height / 2,
        };
      }),
  );
  assert.ok(controls.length >= 3);
  for (const control of controls) {
    assert.ok(control.left >= 0 && control.right <= width, `${control.label} fits at ${width}px`);
    assert.ok(
      Math.abs(control.center - controls[0].center) < 2,
      `${control.label} stays in the same row`,
    );
  }
  for (let i = 1; i < controls.length; i++) {
    assert.ok(controls[i].left >= controls[i - 1].right, "Navbar controls never overlap");
  }
  return box;
}

async function openMenu() {
  const before = await geometry(await page.evaluate(() => innerWidth));
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const trigger = page.getByRole("button", { name: "Navigation menu", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await menu.evaluate((node) =>
    Promise.allSettled(node.getAnimations().map((animation) => animation.finished)),
  );
  const box = await menu.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width, "Menu fits inside the viewport");
  assert.ok(box.y >= 0 && box.y + box.height <= (await page.evaluate(() => innerHeight)));
  assert.equal(
    await page.evaluate(() => document.documentElement.clientWidth),
    width,
    "Menu opening does not shift page width",
  );
  assert.deepEqual(
    await page.getByRole("navigation", { name: "Main", exact: true }).boundingBox(),
    before,
  );
  assert.equal(
    await menu
      .getByRole("menuitem", { name: "Docs Soon", exact: true })
      .getAttribute("data-disabled"),
    "",
  );
  const viewport = await page.evaluate(() => innerWidth);
  const create = menu.getByRole("menuitem", { name: "Create agent", exact: true });
  assert.equal(await create.count(), viewport <= 640 ? 1 : 0, "No duplicated Create agent");
  if (viewport <= 640) {
    assert.equal(await create.getAttribute("href"), "/create");
  }
  const groups = menu.getByRole("group");
  assert.equal(await groups.getByRole("menuitem", { name: "Agents", exact: true }).count(), 1);
  for (const label of ["Explore", "Build", "Resources"]) {
    await menu.getByRole("group", { name: label, exact: true }).waitFor();
  }
  assert.ok(box.height < 420, `Groups stay compact at ${viewport}px (${box.height}px high)`);
  const visibleCreates = await page
    .locator('a[href="/create"]')
    .evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).length);
  assert.equal(visibleCreates, 1, "Create agent is available exactly once while the menu is open");
  await page.keyboard.press("ArrowDown");
  assert.equal(await menu.evaluate((node) => node.contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(
    await trigger.evaluate((node) => node === document.activeElement),
    true,
    "Escape returns focus",
  );
}

try {
  if (!process.argv[2] && !process.env.DESIGN_BASE_URL) {
    servers = await start(root, path.join(output, "servers.log"));
  }
  browser = await openBrowser();
  const desktop = await context();
  page = await desktop.newPage();
  await page.goto(base + profile);
  await page.getByRole("heading", { name: "Halftime", exact: true }).waitFor();
  for (const width of [320, 360, 380, 640, 641, 797, 860, 861, 1100, 1101, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await geometry(width);
    if (width <= 1100) {
      await openMenu();
    } else {
      const explore = page.getByRole("button", { name: "Explore", exact: true });
      await explore.click();
      await page.getByRole("menuitem", { name: /^Tokens/ }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
    }
  }

  await page.setViewportSize({ width: 797, height: 900 });
  await page.getByRole("button", { name: "Navigation menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agents", exact: true }).click();
  await page.waitForURL(base + "/agents");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await geometry(797);

  await page.goto(base + profile);
  await page.getByRole("button", { name: "Navigation menu", exact: true }).click();
  await page.getByRole("menu").waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await geometry(1280);
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page.getByRole("menu").waitFor();
  await page.setViewportSize({ width: 380, height: 900 });
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await geometry(380);
  await page.screenshot({ path: path.join(output, "mobile-380.png"), fullPage: true });
  await page.setViewportSize({ width: 797, height: 900 });
  await page.screenshot({ path: path.join(output, "tablet-797.png"), fullPage: true });
  await page.getByRole("button", { name: "Navigation menu", exact: true }).click();
  await page.getByRole("menu").waitFor();
  await page
    .getByRole("menu")
    .evaluate((node) =>
      Promise.allSettled(node.getAnimations().map((animation) => animation.finished)),
    );
  await page.screenshot({ path: path.join(output, "menu-tablet-797.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 380, height: 900 });
  await page.getByRole("button", { name: "Navigation menu", exact: true }).click();
  await page.getByRole("menu").waitFor();
  await page
    .getByRole("menu")
    .evaluate((node) =>
      Promise.allSettled(node.getAnimations().map((animation) => animation.finished)),
    );
  await page.screenshot({ path: path.join(output, "menu-mobile-380.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });

  const touch = await context({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 320, height: 568 },
    reducedMotion: "reduce",
  });
  page = await touch.newPage();
  await page.goto(base + profile);
  await geometry(320);
  await page.getByRole("button", { name: "Navigation menu", exact: true }).tap();
  await page.getByRole("menu").waitFor();
  const menuBox = await page.getByRole("menu").boundingBox();
  assert.ok(menuBox.y + menuBox.height <= 568, "Short touch viewport scrolls the menu internally");
  await page.getByRole("menuitem", { name: "Agents", exact: true }).tap();
  await page.waitForURL(base + "/agents");
  await geometry(320);
  await touch.close();

  // The adapter sees a controlled local EIP-1193 account, not an extension or actual wallet.
  const connected = await context();
  await connected.addInitScript(() => {
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
      return;
    }
    localStorage.setItem("pk.wallet.kind", "injected");
    let chain = "0x1";
    window.ethereum = {
      request: async ({ method }) => {
        if (method === "eth_accounts") {
          return ["0x1234567890123456789012345678901234567890"];
        }
        if (method === "eth_chainId") {
          return chain;
        }
        if (method === "eth_getBalance") {
          return "0x0";
        }
        if (method === "wallet_switchEthereumChain") {
          chain = "0x279f";
          return null;
        }
        throw new Error(`Unexpected wallet request: ${method}`);
      },
      on: () => {},
      removeListener: () => {},
    };
  });
  page = await connected.newPage();
  await page.goto(base + profile);
  const wallet = page.getByRole("button", { name: /^Wallet, / });
  await wallet.waitFor();
  for (const width of [320, 797, 1101, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await geometry(width);
    await wallet.click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, "Connected wallet menu fits");
    await menu.getByRole("menuitem", { name: "Portfolio", exact: false }).waitFor();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
  }
  await wallet.click();
  await page.getByRole("menuitem", { name: "Switch to Monad Testnet", exact: true }).click();
  await page.getByText("BALANCE", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await connected.close();

  assert.deepEqual(errors, [], "No client exceptions");
  assert.deepEqual(forbidden, [], "No external provider calls");
  console.log(
    "Public navigation passed: one row from 320–1440px, keyboard, touch, short viewport, route navigation, resizing, and controlled connected/wrong-network wallet.",
  );
} catch (error) {
  writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ url: page?.url(), errors, forbidden, message: String(error) }, null, 2),
  );
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  servers?.stop();
}

/** Controlled navbar interaction acceptance. No remote sessions or providers are used. */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { BASE_URL, listening, start } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseUrl = process.env.DESIGN_BASE_URL ?? BASE_URL;
const hostname = new URL(baseUrl).hostname;
assert.ok(
  ["localhost", "127.0.0.1", "app.pickler.localhost"].includes(hostname),
  "Account menu acceptance only targets local fixture previews",
);
let servers = null;
if (!process.env.DESIGN_BASE_URL) {
  assert.equal(await listening(8799), false, "Fixture port is already in use");
  assert.equal(await listening(3001), false, "Web port is already in use");
  servers = await start(root, path.join(tmpdir(), "pickler-account-menu-servers.log"));
}
let browser;
try {
  browser = await openBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const stage of ["draft", "perpl-live", "create-access-pending", "live"]) {
    await page.goto(`${baseUrl}/studio?stage=${stage}`);
    const account = page.locator("[data-account-menu]");
    await account.waitFor();
    assert.equal(await account.count(), 1, stage);
    const trigger = account.getByRole("button", { name: /^Account/ });
    const before = await trigger.boundingBox();
    const credits = page.getByRole("button", { name: "AI credits, soon", exact: true });
    const creditsBefore = (await credits.count()) ? await credits.boundingBox() : null;
    await trigger.hover();
    if (stage === "draft") {
      const username = account.locator('[aria-hidden="true"]').filter({ hasText: "@nightowl" });
      await username.waitFor();
      await page.waitForFunction(() => {
        const label = document.querySelector("[data-account-menu] > span");
        return label && getComputedStyle(label).opacity === "1";
      });
      await page.waitForFunction(() => {
        const label = document.querySelector("[data-account-menu] > span");
        return (
          label &&
          Math.abs(
            parseFloat(getComputedStyle(label).maxWidth) -
              label.firstElementChild.getBoundingClientRect().width,
          ) < 0.5 &&
          label.getBoundingClientRect().width > 70
        );
      });
      const box = await username.boundingBox();
      assert.ok(box && box.x < before.x, "Username reveals to the left");
      const creditsAfter = await credits.boundingBox();
      assert.ok(
        creditsBefore && creditsAfter && creditsAfter.x < creditsBefore.x - 70,
        "Adjacent navbar controls slide left to make room for the username",
      );
      assert.equal(creditsAfter.y, creditsBefore.y, "Controls remain on their original row");
      assert.ok(creditsAfter.x + creditsAfter.width <= box.x, "Username never covers credits");
      await page.mouse.move(10, 250);
      await page.waitForFunction(() => {
        const label = document.querySelector("[data-account-menu] > span");
        return label && label.getBoundingClientRect().width === 0;
      });
      assert.deepEqual(
        await credits.boundingBox(),
        creditsBefore,
        "Controls slide back after hover",
      );
      await trigger.hover();
      await page.waitForFunction(() => {
        const label = document.querySelector("[data-account-menu] > span");
        return (
          label &&
          Math.abs(
            parseFloat(getComputedStyle(label).maxWidth) -
              label.firstElementChild.getBoundingClientRect().width,
          ) < 0.5
        );
      });
    }
    assert.deepEqual(
      await trigger.boundingBox(),
      before,
      "Account icon stays anchored while the other controls slide",
    );
    const route = page.url();
    await trigger.click();
    assert.equal(page.url(), route, "Trigger opens disclosure instead of navigating");
    const profile = account.getByRole("link", { name: "My profile", exact: true });
    await profile.waitFor();
    const profileUrl = new URL(await profile.getAttribute("href"), baseUrl);
    assert.equal(profileUrl.searchParams.get("section"), "profile");
    const returnUrl = new URL(profileUrl.searchParams.get("returnTo"), baseUrl);
    assert.equal(returnUrl.pathname, "/studio");
    assert.equal(returnUrl.searchParams.get("stage"), stage);
    assert.equal(await profile.evaluate((element) => element === document.activeElement), true);
    assert.equal(
      await account.getByRole("button", { name: "Sign out", exact: true }).isDisabled(),
      true,
      "Design previews cannot sign out a real session",
    );
    await page.keyboard.press("Escape");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Enter");
    await profile.waitFor();
    await page.mouse.click(10, 150);
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await trigger.focus();
    await page.keyboard.press("Space");
    await profile.waitFor();
    // Disabled preview sign-out is skipped; Tab leaves the disclosure and closes it.
    await page.keyboard.press("Tab");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  }

  // Keep the pointer stationary where the reported loop occurred, and cover narrower desktops.
  for (const width of [1086, 900, 768]) {
    await page.setViewportSize({ width, height: 1186 });
    await page.goto(`${baseUrl}/studio?stage=draft`);
    const account = page.locator("[data-account-menu]");
    const trigger = account.getByRole("button", { name: /^Account/ });
    await trigger.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const before = await trigger.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    const settled = await page.evaluate(async () => {
      const frames = [];
      const started = performance.now();
      while (performance.now() - started < 1400) {
        await new Promise(requestAnimationFrame);
        const icon = document.querySelector("[data-account-menu] > button").getBoundingClientRect();
        const label = document.querySelector("[data-account-menu] > span").getBoundingClientRect();
        frames.push({ x: icon.x, y: icon.y, width: label.width });
      }
      return frames.slice(-25);
    });
    assert.ok(settled.length > 1);
    for (const frame of settled) {
      assert.equal(frame.y, before.y, "The icon must not wrap away from the stationary pointer");
      assert.ok(Math.abs(frame.x - before.x) < 1, "The right edge remains anchored");
      assert.ok(frame.width > 60, "Username remains expanded under a stationary hover");
      assert.ok(Math.abs(frame.width - settled[0].width) < 1, "Animation settles without a loop");
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const selector = page.getByRole("button", { name: "Halftime, switch agent", exact: true });
    assert.equal(
      await selector.evaluate(
        (element) => !!element.closest('aside[aria-label="Agent workspace"]'),
      ),
      true,
      "Agent selection belongs to the sidebar",
    );
    assert.equal(await page.locator('header button[id$="-agent-chip"]').count(), 0);
    assert.equal(await page.getByText("DRAFT · PRIVATE", { exact: true }).count(), 1);
    await selector.click();
    await page.locator("#draft-agent-menu").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await selector.getAttribute("aria-expanded"), "false");
    if (width === 1086) {
      await trigger.hover();
      await page.screenshot({ path: path.join(tmpdir(), "pickler-navbar-sidebar-desktop.png") });
    }
  }

  // Navigation must restore state selected through the rail, not just its initial URL.
  for (const [stage, section, label, selector] of [
    ["draft", "master", "Master wallet", "#draft-section-master"],
    ["perpl-live", "controls", "Controls", "#live-section-controls"],
  ]) {
    await page.goto(`${baseUrl}/studio?stage=${stage}`);
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.locator(selector).waitFor();
    await page.locator("[data-account-menu] > button").click();
    const link = page.getByRole("link", { name: "My profile", exact: true });
    const destination = new URL(await link.getAttribute("href"), baseUrl);
    const returnTo = destination.searchParams.get("returnTo");
    const workspace = new URL(returnTo, baseUrl);
    assert.equal(workspace.searchParams.get("resume"), section);
    assert.ok(workspace.searchParams.get("agent"), "Selected agent is preserved");
    await link.click();
    await page.waitForURL(/\/account\?section=profile/);
    await page.getByRole("link", { name: "← Back to studio", exact: true }).click();
    await page.waitForURL(`${baseUrl}${returnTo}`);
    await page.locator(selector).waitFor();
    assert.equal(await page.locator(`#${stage === "draft" ? "draft" : "live"}-studio`).count(), 1);
  }

  // Sidebar state is independent of the selected agent and survives account navigation/reload.
  await page.setViewportSize({ width: 1086, height: 1000 });
  for (const [stage, prefix] of [
    ["draft", "draft"],
    ["perpl-live", "live"],
  ]) {
    await page.goto(`${baseUrl}/studio?stage=${stage}`);
    await page.evaluate(() => document.fonts.ready);
    const anchors = await page.evaluate(
      (prefix) => ({
        icon: document.querySelector(`#${prefix}-rail-overview > svg`).getBoundingClientRect().x,
        avatar: document.querySelector(`#${prefix}-agent-chip > span`).getBoundingClientRect().x,
      }),
      prefix,
    );
    assert.equal(
      await page.locator(`#${prefix}-agent-chip > svg.lucide-chevrons-up-down`).count(),
      1,
      "Agent selector shows both directions together",
    );
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    const motion = await page.evaluate(async (prefix) => {
      const samples = [];
      const start = performance.now();
      while (performance.now() - start < 450) {
        await new Promise(requestAnimationFrame);
        const sidebar = document.getElementById(`${prefix}-sidebar`);
        const label = document.querySelector(`#${prefix}-rail-overview > span`);
        const icon = document.querySelector(`#${prefix}-rail-overview > svg`);
        const avatar = document.querySelector(`#${prefix}-agent-chip > span`);
        samples.push({
          width: sidebar.getBoundingClientRect().width,
          opacity: parseFloat(getComputedStyle(label).opacity),
          display: getComputedStyle(label).display,
          iconX: icon.getBoundingClientRect().x,
          avatarX: avatar.getBoundingClientRect().x,
        });
      }
      return samples;
    }, prefix);
    assert.ok(
      motion.filter((frame) => frame.width > 65 && frame.width < 217).length > 5,
      "Sidebar passes through intermediate widths",
    );
    assert.ok(
      motion.some((frame) => frame.opacity > 0 && frame.opacity < 1),
      "Labels fade during the width transition",
    );
    for (let index = 0; index < motion.length; index++) {
      const frame = motion[index];
      assert.notEqual(
        frame.display,
        "none",
        "Labels stay mounted and laid out throughout collapse",
      );
      assert.ok(
        Math.abs(frame.iconX - anchors.icon) < 1,
        "Navigation icon stays anchored during collapse",
      );
      assert.ok(
        Math.abs(frame.avatarX - anchors.avatar) < 1,
        "Agent avatar stays anchored during collapse",
      );
      if (index > 0) {
        assert.ok(
          frame.width <= motion[index - 1].width + 0.5,
          "Width moves continuously toward collapsed state",
        );
      }
    }
    await page.waitForFunction(
      (id) => document.getElementById(id)?.getBoundingClientRect().width === 64,
      `${prefix}-sidebar`,
    );
    assert.equal(await page.locator(`#${prefix}-sidebar`).getAttribute("data-wide"), "false");
    const iconNavigation = page.locator(`#${prefix}-rail-master`);
    assert.equal(await iconNavigation.isVisible(), true, "Collapsed navigation remains accessible");
    await iconNavigation.click();
    await page.locator(`#${prefix}-section-master`).waitFor();
    const selector = page.getByRole("button", { name: "Halftime, switch agent", exact: true });
    await selector.click();
    const menu = page.locator(`#${prefix}-agent-menu`);
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert.ok(
      bounds && bounds.width >= 200 && bounds.x + bounds.width <= 1086,
      "Collapsed agent selector remains usable",
    );
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(tmpdir(), `pickler-sidebar-collapsed-${prefix}.png`) });
    await page.locator("[data-account-menu] > button").click();
    await page.getByRole("link", { name: "My profile", exact: true }).click();
    await page.waitForURL(/\/account\?section=profile/);
    await page.getByRole("link", { name: "← Back to studio", exact: true }).click();
    await page.locator(`#${prefix}-section-master`).waitFor();
    assert.equal(
      await page.locator(`#${prefix}-sidebar`).getAttribute("data-wide"),
      "false",
      "Profile return preserves collapsed sidebar",
    );
    await page.reload();
    await page.waitForFunction(
      (id) => document.getElementById(id)?.getBoundingClientRect().width === 64,
      `${prefix}-sidebar`,
    );
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await page.waitForFunction(
      (id) => document.getElementById(id)?.getBoundingClientRect().width === 218,
      `${prefix}-sidebar`,
    );
    await page.keyboard.press("Control+b");
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).waitFor();
    await page.keyboard.press("Control+b");
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).waitFor();
  }
  await page.goto(`${baseUrl}/studio?stage=draft-brief`);
  await page.locator("#draft-section-brief").waitFor();
  await page.locator("#draft-section-brief textarea").first().focus();
  await page.keyboard.press("Control+b");
  assert.equal(
    await page.locator("#draft-sidebar").getAttribute("data-wide"),
    "true",
    "Editing text never toggles the sidebar shortcut",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator("#draft-sidebar")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
    "0s",
  );

  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(`${baseUrl}/studio?stage=draft`);
  await mobile.getByRole("button", { name: "Master wallet", exact: true }).click();
  await mobile.locator("#draft-section-master").waitFor();
  await mobile.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await mobile.locator("#draft-sidebar").waitFor({ state: "hidden" });
  assert.equal(await mobile.locator("#draft-sidebar").getAttribute("inert"), "");
  assert.equal(
    await mobile.getByRole("button", { name: "Master wallet", exact: true }).count(),
    0,
    "Hidden mobile navigation is absent from the accessibility tree",
  );
  await mobile.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await mobile.locator("#draft-sidebar").waitFor({ state: "visible" });
  await mobile.waitForFunction(() => {
    const item = document.getElementById("draft-rail-master");
    if (!item) {
      return false;
    }
    const bounds = item.getBoundingClientRect();
    return bounds.x >= 0 && bounds.right <= innerWidth;
  });
  assert.equal(await mobile.locator("#draft-rail-master").getAttribute("aria-current"), "page");
  await mobile.getByRole("button", { name: "Master wallet", exact: true }).focus();
  await mobile.keyboard.press("Control+b");
  const expand = mobile.getByRole("button", { name: "Expand sidebar", exact: true });
  assert.equal(
    await expand.evaluate((element) => element === document.activeElement),
    true,
    "Keyboard collapse restores focus to its toggle on mobile",
  );
  await expand.click();
  const trigger = mobile.locator("[data-account-menu] > button");
  const mobileSelector = mobile.getByRole("button", {
    name: "Halftime, switch agent",
    exact: true,
  });
  await mobileSelector.click();
  const agentMenu = mobile.locator("#draft-agent-menu");
  await agentMenu.waitFor();
  const menuBounds = await agentMenu.boundingBox();
  assert.ok(
    menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390,
    "Sidebar selector menu fits touch screens without clipping in the rail scroller",
  );
  await mobile.keyboard.press("Escape");
  await trigger.click();
  const profile = mobile.getByRole("link", { name: "My profile", exact: true });
  await profile.waitFor();
  const bounds = await profile.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "Menu fits mobile");
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await mobile.screenshot({ path: path.join(tmpdir(), "pickler-account-menu-mobile.png") });
  await profile.click();
  await mobile.waitForURL(/\/account\?section=profile/);
  await mobile.getByRole("button", { name: "Public profile", exact: true }).waitFor();
  assert.equal(
    await mobile
      .getByRole("button", { name: "Public profile", exact: true })
      .getAttribute("aria-current"),
    "true",
  );
  await mobile.getByRole("link", { name: "← Back to studio", exact: true }).click();
  await mobile.locator("#draft-studio").waitFor();
  assert.equal(new URL(mobile.url()).searchParams.get("stage"), "draft");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: hover geometry, click, profile round trips preserving agent/section/stage, Escape/focus, Tab, outside click, sidebar collapse/persistence/selector/keyboard and mobile. Controlled previews only.",
  );
} finally {
  await browser?.close();
  servers?.stop();
}

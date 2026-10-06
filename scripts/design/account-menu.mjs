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
          getComputedStyle(label).maxWidth === "240px" &&
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
        return label && getComputedStyle(label).maxWidth === "240px";
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
    assert.equal(await profile.getAttribute("href"), "/account?section=profile");
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

  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(`${baseUrl}/studio?stage=draft`);
  const trigger = mobile.locator("[data-account-menu] > button");
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
  assert.deepEqual(errors, []);
  console.log(
    "PASS: hover geometry, click, profile, Escape/focus, Tab, outside click and mobile. Controlled previews only.",
  );
} finally {
  await browser?.close();
  servers?.stop();
}

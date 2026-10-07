/** Frame-based regression for Studio chrome. Local fixtures only; no provider calls. */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";
import { BASE_URL, listening, start } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseUrl = process.env.DESIGN_BASE_URL ?? BASE_URL;
assert.ok(
  ["localhost", "127.0.0.1", "app.pickler.localhost"].includes(new URL(baseUrl).hostname),
  "Motion acceptance requires an explicit local fixture preview",
);
let servers;
let browser;
try {
  if (!process.env.DESIGN_BASE_URL) {
    assert.equal(await listening(8799), false, "Fixture port is already in use");
    assert.equal(await listening(3001), false, "Preview port is already in use");
    servers = await start(root, path.join(tmpdir(), "pickler-sidebar-motion-servers.log"));
  }
  browser = await openBrowser();
  const page = await browser.newPage({ viewport: { width: 1086, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [stage, prefix] of [
    ["draft", "draft"],
    ["perpl-live", "live"],
  ]) {
    await page.setViewportSize({ width: 1086, height: 1000 });
    await page.goto(`${baseUrl}/studio?stage=${stage}`);
    await page.locator(`#${prefix}-agent-chip`).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("main")].every((element) =>
        element
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    );

    for (const width of [1440, 1086, 900, 811, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.mouse.move(width - 10, 950);
      for (const direction of ["collapse", "expand"]) {
        const frames = await page.evaluate(async (prefix) => {
          const sidebar = document.getElementById(`${prefix}-sidebar`);
          const group = sidebar.closest('[data-slot="sidebar"][data-state]');
          const gap = group.querySelector('[data-slot="sidebar-gap"]');
          const buttons = [...sidebar.querySelectorAll('[data-sidebar="menu-button"]')];
          const avatar = sidebar.querySelector('[data-size="chip"]');
          const labels = [...sidebar.querySelectorAll("[data-sidebar-label]")];
          const main = document.querySelector("main");
          const column = main.firstElementChild;
          const header = document.querySelector(`#${prefix}-studio > header`);
          const section = document.getElementById(`${prefix}-section-overview`);
          const bounds = (element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          };
          const baseline = {
            column: bounds(column),
            section: bounds(section),
            header: bounds(header),
            avatar: bounds(avatar),
          };
          const samples = [];
          document.querySelector("[data-sidebar-toggle]").click();
          const start = performance.now();
          do {
            await new Promise(requestAnimationFrame);
            samples.push({
              elapsed: performance.now() - start,
              sameButtons: buttons.every(
                (button, index) =>
                  sidebar.querySelectorAll('[data-sidebar="menu-button"]')[index] === button,
              ),
              sameMain: main === document.querySelector("main"),
              width: bounds(sidebar).width,
              gapWidth: bounds(gap).width,
              column: bounds(column),
              section: bounds(section),
              header: bounds(header),
              avatar: bounds(avatar),
              opacity: parseFloat(getComputedStyle(labels[0]).opacity),
              labelsPresent: labels.every(
                (label) => label.isConnected && getComputedStyle(label).display !== "none",
              ),
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
            });
          } while (performance.now() - start < 500);
          return { baseline, samples };
        }, prefix);
        const { baseline, samples } = frames;
        const context = `${stage}, ${width}px, ${direction}`;
        assert.ok(samples.length > 2, `Captured animation frames: ${context}`);
        assert.ok(
          samples.some((frame) => frame.width > 65 && frame.width < 217),
          `Intermediate widths: ${context}`,
        );
        assert.ok(
          samples.some((frame) => frame.opacity > 0 && frame.opacity < 1),
          `Labels fade: ${context}`,
        );
        for (const [index, frame] of samples.entries()) {
          assert.ok(frame.sameButtons && frame.sameMain, `DOM identity preserved: ${context}`);
          assert.ok(frame.labelsPresent, `No hard label hiding: ${context}`);
          assert.equal(frame.overflow, false, `No page overflow: ${context}`);
          assert.ok(
            Math.abs(frame.width - frame.gapWidth) < 0.5,
            `One synchronized layout width: ${context}`,
          );
          assert.ok(
            Math.abs(frame.column.width - baseline.column.width) < 0.5,
            `Card measure stays fixed: ${context}`,
          );
          assert.ok(
            Math.abs(frame.section.y - baseline.section.y) < 0.5,
            `No vertical content jump: ${context}`,
          );
          assert.deepEqual(
            frame.header,
            baseline.header,
            `Navbar is independent of sidebar: ${context}`,
          );
          assert.ok(
            Object.keys(baseline.avatar).every(
              (key) => Math.abs(frame.avatar[key] - baseline.avatar[key]) < 0.5,
            ),
            `Avatar anchor is stable within subpixel rounding: ${context}`,
          );
          if (index > 0) {
            const difference = frame.width - samples[index - 1].width;
            assert.ok(
              direction === "collapse" ? difference <= 0.5 : difference >= -0.5,
              `Monotonic geometry: ${context}`,
            );
          }
        }
        assert.ok(
          Math.abs(samples.at(-1).width - (direction === "collapse" ? 64 : 218)) < 0.5,
          `Settles at target: ${context}`,
        );
        if (direction === "collapse") {
          const alignment = await page.evaluate((prefix) => {
            const sidebar = document.getElementById(`${prefix}-sidebar`);
            const rail = sidebar.getBoundingClientRect();
            const avatar = sidebar.querySelector('[data-size="chip"]').getBoundingClientRect();
            return [
              ...sidebar.querySelectorAll(
                '[data-slot="sidebar-group"] [data-sidebar="menu-button"]',
              ),
            ].map((button) => {
              const box = button.getBoundingClientRect();
              const icon = button.querySelector("svg").getBoundingClientRect();
              return {
                width: box.width,
                height: box.height,
                iconOffset: icon.x + icon.width / 2 - (box.x + box.width / 2),
                railOffset: box.x + box.width / 2 - (rail.x + rail.width / 2),
                avatarOffset: icon.x + icon.width / 2 - (avatar.x + avatar.width / 2),
              };
            });
          }, prefix);
          assert.ok(alignment.length > 0);
          for (const item of alignment) {
            assert.equal(item.width, 32, `Compact selection background: ${context}`);
            assert.equal(item.height, 32, `Square selection background: ${context}`);
            assert.ok(Math.abs(item.iconOffset) < 0.5, `Icon centered in its button: ${context}`);
            assert.ok(Math.abs(item.railOffset) < 1, `Button centered in the rail: ${context}`);
            assert.ok(Math.abs(item.avatarOffset) < 1, `Avatar and icons align: ${context}`);
          }
        }
      }
    }

    // Tooltip state must not outlive hover, activation, a menu, or the collapsed context.
    const disclosure = page.locator("[data-sidebar-toggle]");
    await disclosure.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-slot="sidebar"][data-state]')?.dataset.state === "collapsed",
    );
    await page.waitForFunction(() => {
      const sidebar = document.querySelector('[data-slot="sidebar-container"]');
      return Math.abs(sidebar.getBoundingClientRect().width - 64) < 0.5;
    });
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    const selector = page.locator(`#${prefix}-agent-chip`);
    const overview = page.locator(`#${prefix}-rail-overview`);
    const brief = page.locator(`#${prefix}-rail-brief`);
    const leaveSidebar = () => page.mouse.move(1000, 950, { steps: 10 });
    const noTooltip = () => tooltip.waitFor({ state: "hidden" });

    await overview.hover();
    await tooltip.waitFor({ state: "visible" });
    assert.equal(await tooltip.count(), 1, "Only the current icon owns a tooltip");
    await tooltip.hover();
    assert.equal(await tooltip.isVisible(), true, "Tooltip text remains reachable by pointer");
    await leaveSidebar();
    await noTooltip();

    await brief.hover();
    await tooltip.waitFor({ state: "visible" });
    await brief.click();
    await page.locator(`#${prefix}-section-brief`).waitFor();
    await leaveSidebar();
    await noTooltip();

    for (const activation of ["pointer", "keyboard", "select"]) {
      await selector.hover();
      await tooltip.waitFor({ state: "visible" });
      if (activation === "keyboard") {
        await selector.focus();
        await page.keyboard.press("Enter");
      } else {
        await selector.click();
      }
      const menu = page.locator(`#${prefix}-agent-menu[data-state="open"]`);
      await menu.waitFor();
      await noTooltip();
      await leaveSidebar();
      if (activation === "select") {
        await menu.getByRole("menuitem", { name: /Halftime/ }).click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForFunction(
        (prefix) => document.activeElement?.id === `${prefix}-agent-chip`,
        prefix,
      );
      await noTooltip();
      // Sample after return-focus/exit effects; a transient hidden state is not enough.
      const restored = await page.evaluate(async () => {
        const samples = [];
        const started = performance.now();
        while (performance.now() - started < 450) {
          await new Promise(requestAnimationFrame);
          samples.push(document.querySelectorAll('[data-slot="tooltip-content"]').length);
        }
        return samples;
      });
      assert.ok(
        restored.every((count) => count === 0),
        `No restored-focus tooltip: ${activation}`,
      );
    }

    // Genuine keyboard navigation still provides the collapsed label and a clean focus outline.
    await page.keyboard.press("Tab");
    await page.waitForFunction(
      (prefix) => document.activeElement?.id === `${prefix}-rail-overview`,
      prefix,
    );
    await tooltip.waitFor({ state: "visible" });
    const focusedIcon = await overview.evaluate((element) => {
      const style = getComputedStyle(element);
      const svg = element.querySelector("svg");
      return {
        shadow: style.boxShadow,
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        svgWidth: svg.getBoundingClientRect().width,
        intrinsicWidth: Number(svg.getAttribute("width")),
        svgShadow: getComputedStyle(svg).boxShadow,
        svgFilter: getComputedStyle(svg).filter,
      };
    });
    assert.equal(focusedIcon.shadow, "none", "No focus shadow halo around navigation icons");
    assert.equal(focusedIcon.outline, "solid", "Keyboard focus remains visible");
    assert.equal(focusedIcon.outlineWidth, "2px");
    assert.equal(
      focusedIcon.svgWidth,
      focusedIcon.intrinsicWidth,
      "SVG stroke uses its actual size",
    );
    assert.equal(focusedIcon.svgShadow, "none");
    assert.equal(focusedIcon.svgFilter, "none");
    await page.keyboard.press("Escape");
    await noTooltip();
    await page.keyboard.press("Tab");
    await tooltip.waitFor({ state: "visible" });
    await page.keyboard.press("Control+b");
    await noTooltip();
    await page.keyboard.press("Control+b");
    await noTooltip();
    await page.keyboard.press("Tab");
    await tooltip.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await noTooltip();
    await page.screenshot({ path: path.join(tmpdir(), `pickler-${prefix}-sidebar-tooltips.png`) });
    await disclosure.click();
    await leaveSidebar();
    await noTooltip();

    // Responsive mode may change at a breakpoint, but must not recreate the page or overflow it.
    const main = await page.locator("main").elementHandle();
    for (const width of [
      1240, 1239, 920, 919, 769, 768, 767, 641, 640, 600, 561, 560, 480, 390, 360, 320, 768, 1440,
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(
        await main.evaluate((element) => element === document.querySelector("main")),
        true,
        `Resize preserves main: ${stage}, ${width}px`,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `Resize avoids overflow: ${stage}, ${width}px`,
      );
      const controls = await page
        .locator('[title="Master wallet"], [aria-label="AI credits, soon"], [data-account-menu]')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
      // Buttons have different heights, so compare their centers rather than top edges.
      const centers = await page
        .locator('[title="Master wallet"], [aria-label="AI credits, soon"], [data-account-menu]')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.y + bounds.height / 2;
          }),
        );
      assert.equal(controls.length, 3);
      assert.ok(
        Math.max(...centers) - Math.min(...centers) < 0.5,
        `Global controls share a row: ${stage}, ${width}px`,
      );
      const navbarCenters = await page.locator(`#${prefix}-studio > header`).evaluate((header) =>
        [...header.children]
          .map((element) => element.getBoundingClientRect())
          .filter((bounds) => bounds.width > 0 && bounds.height > 0)
          .map((bounds) => bounds.y + bounds.height / 2),
      );
      assert.ok(
        Math.max(...navbarCenters) - Math.min(...navbarCenters) < 0.5,
        `Brand, network and global controls share a row: ${stage}, ${width}px`,
      );
    }

    // Stationary hover must reveal compact controls without moving the icon out from under it.
    for (const width of [560, 480, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const selector of ["[data-wallet-balance]", "[data-credits-control]"]) {
        await page.mouse.move(width / 2, 950);
        await page.waitForTimeout(400);
        const control = page.locator(selector);
        const before = await control.boundingBox();
        assert.equal(before.width, 38, "Compact control starts as an icon");
        const preceding =
          selector === "[data-wallet-balance]"
            ? page.getByLabel("Monad testnet", { exact: true })
            : page.locator("[data-wallet-balance]");
        const precedingBefore = await preceding.boundingBox();
        const anchor = { x: before.x + before.width - 19, y: before.y + 19 };
        await page.evaluate((selector) => {
          const button = document.querySelector(selector);
          const navbar = button.closest("header");
          const height = navbar.getBoundingClientRect().height;
          window.compactFrames = (async () => {
            const frames = [];
            const start = performance.now();
            do {
              await new Promise(requestAnimationFrame);
              const box = button.getBoundingClientRect();
              frames.push({
                width: box.width,
                right: box.right,
                height: navbar.getBoundingClientRect().height,
                sameButton: document.querySelector(selector) === button,
                hover: button.matches(":hover"),
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
              });
            } while (performance.now() - start < 800);
            return { height, frames };
          })();
        }, selector);
        await page.mouse.move(anchor.x, anchor.y);
        const { height, frames } = await page.evaluate(() => window.compactFrames);
        const context = `${stage}, ${width}px, ${selector}`;
        const hovered = frames.filter((frame) => frame.hover);
        assert.ok(hovered.length > 2, `Hover stays reachable: ${context}`);
        assert.ok(
          hovered.some((frame) => frame.width > 40 && frame.width < 90),
          `Intermediate expansion: ${context}`,
        );
        for (const frame of hovered) {
          assert.ok(frame.sameButton, `No remount: ${context}`);
          assert.ok(
            Math.abs(frame.right - (before.x + before.width)) < 0.5,
            `Right icon stays anchored: ${context}`,
          );
          assert.equal(frame.height, height, `No navbar row jump: ${context}`);
          assert.equal(frame.overflow, false, `No expansion overflow: ${context}`);
        }
        const precedingAfter = await preceding.boundingBox();
        assert.ok(
          precedingAfter.x + precedingAfter.width < precedingBefore.x + precedingBefore.width - 40,
          `Preceding control slides left: ${context}`,
        );
        assert.ok(frames.at(-1).hover, `No hover oscillation: ${context}`);
        assert.ok(frames.at(-1).width > 85, `Details settle visibly: ${context}`);
        const details = await control.locator('[class*="navReveal"]').evaluate((element) => ({
          width: element.clientWidth,
          contentWidth: element.firstElementChild.scrollWidth,
          opacity: getComputedStyle(element).opacity,
        }));
        assert.equal(details.opacity, "1", `Labels are visible: ${context}`);
        assert.ok(
          details.contentWidth <= details.width + 1,
          `Complete fixture balances/credits: ${context}`,
        );
        await page.mouse.move(width / 2, 950);
        await page.waitForTimeout(400);
        assert.ok(
          Math.abs((await control.boundingBox()).width - 38) < 0.5,
          `Pointer exit contracts once: ${context}`,
        );
        await page.keyboard.press("Tab");
        await control.focus();
        await page.waitForTimeout(400);
        assert.ok((await control.boundingBox()).width > 85, `Keyboard reveals details: ${context}`);
        await control.evaluate((element) => element.blur());
        await page.waitForTimeout(400);
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("[data-credits-control]").hover();
    assert.equal(
      await page
        .locator('[data-credits-control] [class*="navReveal"]')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      "0s",
      "Reduced motion disables compact expansion animation",
    );
    await page.mouse.move(100, 950);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  const touch = await browser.newContext({
    viewport: { width: 390, height: 1000 },
    isMobile: true,
    hasTouch: true,
  });
  const touchPage = await touch.newPage();
  touchPage.on("pageerror", (error) => errors.push(error.message));
  await touchPage.goto(`${baseUrl}/studio?stage=draft`);
  for (const [selector, dialog] of [
    ["[data-wallet-balance]", "#new-agent-wallets"],
    ["[data-credits-control]", "#new-agent-credits"],
  ]) {
    const control = touchPage.locator(selector);
    await control.tap();
    await touchPage.locator(`${dialog}[open]`).waitFor();
    await touchPage.locator(dialog).getByRole("button", { name: "Close", exact: true }).tap();
    await touchPage.locator(`${dialog}[open]`).waitFor({ state: "hidden" });
    await touchPage.waitForTimeout(400);
    assert.equal((await control.boundingBox()).width, 38, "Touch does not retain hover expansion");
  }
  await touch.close();
  assert.deepEqual(errors, [], "No browser errors");
  console.log(
    "PASS: stable DOM, synchronized sidebar geometry, fading labels, anchored avatar/navbar, fixed card measure, tooltip dismissal/keyboard access, crisp icons, responsive breakpoints, compact wallet/credits hover and focus, touch dialogs, reduced motion and no overflow. Controlled fixtures only.",
  );
} finally {
  await browser?.close();
  servers?.stop();
}

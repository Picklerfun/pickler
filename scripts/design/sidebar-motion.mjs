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

    for (const width of [1440, 1086, 900, 768]) {
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
      }
    }

    // Responsive mode may change at a breakpoint, but must not recreate the page or overflow it.
    const main = await page.locator("main").elementHandle();
    for (const width of [1240, 1239, 920, 919, 768, 767, 640, 480, 390, 360, 768, 1440]) {
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
        .locator('[title="Your wallets"], [aria-label="AI credits, soon"], [data-account-menu]')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
      // Buttons have different heights, so compare their centers rather than top edges.
      const centers = await page
        .locator('[title="Your wallets"], [aria-label="AI credits, soon"], [data-account-menu]')
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
    }
  }
  assert.deepEqual(errors, [], "No browser errors");
  console.log(
    "PASS: stable DOM, synchronized sidebar geometry, fading labels, anchored avatar/navbar, fixed card measure, responsive breakpoints and no overflow. Controlled fixtures only.",
  );
} finally {
  await browser?.close();
  servers?.stop();
}

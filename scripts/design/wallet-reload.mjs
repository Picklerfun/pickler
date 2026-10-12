/** Controlled browser connection only: no real wallet, authentication or chain requests. */
import assert from "node:assert/strict";
import { openBrowser } from "./lib/browser.mjs";
const base = process.argv[2] ?? "http://localhost:3005";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const wallet = "0x5555555555555555555555555555555555555555";
const browser = await openBrowser();
try {
  for (const scenario of ["delayed", "slow-balance", "locked"]) {
    const context = await browser.newContext();
    const failures = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
        failures.push(url.origin);
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(
      ({ wallet, scenario }) => {
        if (!sessionStorage.getItem("controlled.visited")) {
          localStorage.setItem("pk.wallet.kind", "injected");
          sessionStorage.setItem("controlled.visited", "yes");
        }
        window.__requests = [];
        const extension = {
          on() {},
          removeListener() {},
          async request({ method }) {
            window.__requests.push(method);
            if (method === "eth_accounts") {
              return scenario === "locked" ? [] : [wallet];
            }
            if (method === "eth_chainId") {
              return "0x279f";
            }
            if (method === "eth_getBalance") {
              return scenario === "slow-balance" ? new Promise(() => {}) : "0x1";
            }
            if (method === "wallet_revokePermissions") {
              return null;
            }
            throw new Error("Unexpected wallet prompt " + method);
          },
        };
        if (scenario === "delayed") {
          setTimeout(() => {
            window.ethereum = extension;
          }, 400);
        } else {
          window.ethereum = extension;
        }
      },
      { wallet, scenario },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(base);
    if (scenario === "locked") {
      await page.waitForFunction(() => window.__requests.includes("eth_accounts"));
      await page.getByRole("button", { name: "Connect wallet", exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__requests), ["eth_accounts"]);
    } else {
      const connected = page.getByRole("button", { name: "Wallet, 0x5555…5555", exact: true });
      await connected.waitFor();
      await page.reload();
      await connected.waitFor();
      assert.deepEqual(
        (await page.evaluate(() => window.__requests)).sort(),
        ["eth_accounts", "eth_chainId", "eth_getBalance"].sort(),
      );
      await connected.click();
      await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
      await page.getByRole("button", { name: "Connect wallet", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Connect wallet", exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert.deepEqual(
        await page.evaluate(() => window.__requests),
        [],
        "explicit disconnect survives reload",
      );
      assert.equal(await page.evaluate(() => localStorage.getItem("pk.wallet.kind")), null);
    }
    assert.deepEqual(failures, []);
    await context.close();
  }
  console.log(
    "PASS: silent reload, delayed injection, slow balance, locked wallet and persistent disconnect",
  );
} finally {
  await browser.close();
}

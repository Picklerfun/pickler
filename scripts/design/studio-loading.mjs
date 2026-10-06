/** Presentation regression with synthetic Auth/API responses; no production data or providers. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { openBrowser } from "./lib/browser.mjs";
import { listening } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = "http://localhost:3012";
const output = mkdtempSync(path.join(tmpdir(), "pickler-loading-"));
const nextEnv = path.join(root, "apps/web/next-env.d.ts");
const originalNextEnv = readFileSync(nextEnv, "utf8");
const children = [];
const errors = [];
let browser;
const userId = "10000000-0000-4000-8000-000000000001";
const profile = {
  user_id: userId,
  display_name: "Loading regression",
  handle: "loadingcheck",
  created_at: "2026-01-01T00:00:00Z",
};
const wallet = {
  address: "0x0000000000000000000000000000000000000001",
  balances: {
    native: { symbol: "MON", decimals: 18, raw: "1000000000000000000" },
    token: { symbol: "AUSD", decimals: 6, raw: "10000000" },
  },
};
const keys = [
  {
    id: "controlled-key",
    credential_id: "controlled-credential",
    label: "Controlled passkey",
    transports: ["internal"],
    device_type: "singleDevice",
    created_at: "2026-01-01T00:00:00Z",
    last_used_at: null,
  },
];
const envelope = (data) => ({ success: true, message: "Controlled response", data });
const responses = {
  "/api/v1/profile": envelope(profile),
  "/api/v1/signing/wallets/me": envelope(wallet),
  "/api/v1/signing/passkeys": envelope(keys),
  "/api/v1/studio/onboard": {},
  "/api/v1/studio/me": { enabled: true, canManage: true, workspaceId: userId },
  "/api/v1/studio/agents": { agents: [] },
  "/api/v1/studio/market-categories": { version: 1, categories: [] },
  "/api/v1/studio/options": { plugins: [] },
  "/api/v1/studio/wallets": {
    chainId: 10143,
    master: {
      walletId: "controlled-master",
      address: wallet.address,
      ausdMicro: "10000000",
      monWei: "1000000000000000000",
    },
    agents: [],
    readAt: "2026-01-01T00:00:00Z",
  },
  "/api/v1/signing/agents/state": envelope({
    has_sub_organization: true,
    has_delegated_user: true,
  }),
};

function launch(args, env) {
  const log = openSync(path.join(output, `server-${children.length}.log`), "w");
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", log, log] });
  closeSync(log);
  children.push(child);
}

async function ready() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      if ((await fetch(`${base}/signin`)).ok) {
        return;
      }
    } catch {
      // This runner owns the startup and stops both processes below.
    }
    await delay(500);
  }
  throw new Error(`Local web did not start; logs: ${output}`);
}

try {
  for (const port of [3012, 8812]) {
    assert.equal(await listening(port), false, `Controlled port ${port} is already in use`);
  }
  launch(["--import", "tsx", "scripts/design/fixture-api.mjs", "8812"], process.env);
  launch(["node_modules/next/dist/bin/next", "dev", "apps/web", "-p", "3012"], {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8812",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "controlled-public-key",
    NEXT_PUBLIC_MARKETPLACE_HOST: "",
    NEXT_PUBLIC_STUDIO_HOST: "",
    PICKLER_API_LOCAL_URL: "http://127.0.0.1:8812",
  });
  await ready();
  browser = await openBrowser();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp: expiresAt })}.controlled`,
    refresh_token: "controlled-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: userId, email: "loading@example.test", user_metadata: {} },
  };
  for (const scenario of [
    "studio",
    "account",
    "passkey",
    "studio-error",
    "studio-missing-wallet",
    "studio-wallets",
  ]) {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "sb-localhost-auth-token",
        value: `base64-${encode(session)}`,
        url: base,
      },
    ]);
    const counts = new Map();
    let walletPhase = "initial";
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
        errors.push(`Unexpected external request: ${url.hostname}`);
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) {
        return route.continue();
      }
      counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
      await delay(250);
      let status = 200;
      let json = responses[url.pathname];
      if (url.pathname === "/api/v1/signing/wallets/me" && scenario === "studio-missing-wallet") {
        status = 404;
        json = { success: false, error: "not_found", message: "No wallet" };
      } else if (url.pathname === "/api/v1/studio/options" && scenario === "studio-error") {
        status = 503;
        json = { error: "UNAVAILABLE", message: "Controlled load failure" };
      } else if (url.pathname === "/api/v1/studio/access-request") {
        json = { status: "enabled", canReview: false };
      }
      if (url.pathname === "/api/v1/studio/wallets" && scenario === "studio-wallets") {
        assert.equal(route.request().method(), "GET");
        if (walletPhase === "failed") {
          status = 503;
          json = { error: "UNAVAILABLE", message: "Controlled balance failure" };
        } else {
          const updated = walletPhase === "updated";
          let chainId = 10143;
          if (walletPhase === "unknown-network") {
            chainId = null;
          } else if (walletPhase === "mainnet") {
            chainId = 143;
          }
          json = {
            ...responses[url.pathname],
            chainId,
            master: {
              ...responses[url.pathname].master,
              ausdMicro: updated ? "20000000" : "10000000",
            },
            agents: [
              {
                walletId: "controlled-agent",
                address: "0x0000000000000000000000000000000000000002",
                agentId: null,
                agentName: null,
                caps: null,
                policiesApproved: true,
                ausdMicro: updated ? "12000000" : "0",
                monWei: "0",
              },
            ],
            readAt: Date.now(),
          };
        }
      }
      if (!json) {
        errors.push(`Unexpected API request: ${url.pathname}`);
        return route.abort();
      }
      return route.fulfill({ status, json });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const route = scenario.startsWith("studio") ? "/studio" : `/${scenario}`;
    await page.goto(`${base}${route}`);
    if (scenario === "studio-missing-wallet") {
      await page.waitForURL("**/signup?step=passkey");
    } else if (scenario === "studio-error") {
      await page.getByText(/Controlled load failure/).waitFor();
      await page.getByRole("button", { name: /try again/i }).waitFor();
    } else if (scenario === "studio-wallets") {
      await page.getByTitle("Your wallet", { exact: true }).click();
      const modal = page.locator("#new-agent-wallets");
      await modal.getByText("MONAD TESTNET", { exact: true }).waitFor();
      await modal.getByRole("button", { name: "Add funds to agent" }).click();
      await modal.getByRole("button", { name: "All wallets" }).waitFor();
      assert.equal(await modal.locator('[data-master="true"]').count(), 0);
      const route = modal.getByLabel("Transfer route");
      await route.getByText("Your wallet", { exact: true }).waitFor();
      await route.getByText("From", { exact: true }).waitFor();
      await route.getByText("To", { exact: true }).waitFor();
      const amount = modal.locator('[data-amount="controlled-agent"]');
      await amount.fill("2");
      const refresh = modal.getByRole("button", { name: "Refresh balances" });
      const before = counts.get("/api/v1/studio/wallets");
      walletPhase = "updated";
      await refresh.focus();
      await refresh.press("Enter");
      assert.equal(await refresh.isDisabled(), true);
      assert.equal(await refresh.getAttribute("aria-busy"), "true");
      assert.ok((await modal.locator(".pk-skeleton").count()) >= 4);
      assert.equal(
        await modal.getByRole("button", { name: "Add funds to agent" }).isDisabled(),
        true,
      );
      assert.equal(await amount.inputValue(), "2");
      await modal.getByText("20", { exact: true }).waitFor();
      await modal.getByText("12", { exact: true }).waitFor();
      assert.equal(await amount.inputValue(), "2");
      assert.equal(counts.get("/api/v1/studio/wallets"), before + 1);
      await page.setViewportSize({ width: 1000, height: 1186 });
      await modal.screenshot({ path: path.join(output, "wallet-refresh.png") });

      walletPhase = "failed";
      await refresh.click();
      await modal
        .getByRole("alert")
        .getByText(/Last known balances/)
        .waitFor();
      assert.equal(await refresh.isEnabled(), true);
      assert.equal(await modal.getByText("20", { exact: true }).count(), 1);
      assert.equal(await modal.getByText("12", { exact: true }).count(), 1);
      assert.equal(await amount.inputValue(), "2");
      assert.equal(counts.get("/api/v1/studio/wallets"), before + 2);

      walletPhase = "mainnet";
      await refresh.click();
      await modal.getByText("MONAD MAINNET", { exact: true }).waitFor();
      assert.equal(await modal.getByText("MONAD TESTNET", { exact: true }).count(), 0);
      assert.equal(counts.get("/api/v1/studio/wallets"), before + 3);

      walletPhase = "unknown-network";
      await refresh.click();
      await modal.getByText("NETWORK UNAVAILABLE", { exact: true }).waitFor();
      await modal
        .getByRole("alert")
        .getByText(/network could not be confirmed/)
        .waitFor();
      assert.equal(
        await modal.getByRole("button", { name: "Add funds to agent" }).isDisabled(),
        true,
      );
      assert.equal(await modal.getByRole("button", { name: /Send 2 AUSD/ }).isDisabled(), true);
      assert.equal(await amount.inputValue(), "2");
      assert.equal(counts.get("/api/v1/studio/wallets"), before + 4);
      await modal.getByRole("button", { name: "All wallets" }).click();
      await modal.locator('[data-master="true"]').waitFor();
    } else if (scenario === "studio") {
      await page.getByRole("button", { name: /Create its wallet/ }).waitFor();
      assert.equal(await page.locator("#studio-pending").count(), 0);
    } else if (scenario === "account") {
      await page
        .locator("#account-wallet-card")
        .getByRole("button", { name: "Receive", exact: true })
        .waitFor();
    } else {
      await page.locator("#passkey-add").getByText("Controlled passkey", { exact: true }).waitFor();
    }
    // Exercise unrelated layout and section renders after delayed reads complete.
    await page.setViewportSize({ width: 900, height: 1000 });
    await delay(1500);
    for (const [endpoint, count] of counts) {
      const walletRead = ["/api/v1/studio/wallets", "/api/v1/signing/agents/state"].includes(
        endpoint,
      );
      let maximum = 2;
      if (scenario === "studio-wallets" && walletRead) {
        maximum = 6;
      } else if (scenario === "studio-missing-wallet") {
        maximum = 4;
      }
      assert.ok(count <= maximum, `${scenario}: ${endpoint} repeated ${count} times`);
    }
    assert.deepEqual(errors, [], scenario);
    console.log(JSON.stringify({ scenario, status: "passed", calls: Object.fromEntries(counts) }));
    await context.close();
  }
} finally {
  await browser?.close();
  for (const child of children) {
    child.kill("SIGTERM");
  }
  writeFileSync(nextEnv, originalNextEnv);
  console.log(`Controlled logs: ${output}`);
}

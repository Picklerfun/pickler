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
import { liveStudioFixture } from "../../apps/web/src/features/studio/live/fixture.ts";

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
const tokenAgentId = "20000000-0000-4000-8000-000000000002";
const tokenFixture = liveStudioFixture("perpl-live");
const tokenAgent = {
  ...tokenFixture.agent,
  id: tokenAgentId,
  productId: tokenAgentId,
  draft: true,
  visibility: "private",
  publishedAt: null,
};
const tokenState = {
  ...tokenFixture.tokenState,
  available: false,
  blockers: ["GO_PUBLIC_FIRST", "LAUNCH_UNAVAILABLE"],
  draft: { id: tokenAgentId, version: 1, name: "Saved token", ticker: "SAVE", status: "draft" },
};
const envelope = (data) => ({ success: true, message: "Controlled response", data });
const responses = {
  "/api/v1/profile": envelope(profile),
  "/api/v1/handles/loadingcheck/availability": envelope({
    handle: "loadingcheck",
    available: true,
  }),
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
    "studio-markets",
    "studio-token",
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
    let cataloguePhase = "ready";
    let clientClockOffset = 0;
    let tokenPhase = "loading";
    let releaseToken;
    const tokenGate = new Promise((resolve) => {
      releaseToken = resolve;
    });
    const catalogueCounts = new Map();
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
      if (scenario === "studio-token") {
        const prefix = `/api/v1/studio/agents/${tokenAgentId}`;
        const specific = {
          "/api/v1/studio/agents": { agents: [tokenAgent] },
          [prefix]: tokenAgent,
          [prefix + "/x"]: tokenFixture.x,
          [prefix + "/activity"]: { events: [] },
          [prefix + "/runs"]: { runs: [] },
          [prefix + "/perps/record"]: tokenFixture.runtime.record,
          [prefix + "/perps/positions"]: tokenFixture.runtime.positions,
          [prefix + "/perps/checks"]: { checks: [], nextCursor: null },
        };
        json = specific[url.pathname] ?? json;
        if (url.pathname === prefix + "/token") {
          assert.equal(route.request().method(), "GET");
          if (tokenPhase === "loading") {
            await tokenGate;
          }
          status = tokenPhase === "failed" ? 503 : 200;
          json =
            tokenPhase === "failed"
              ? { error: "UNAVAILABLE", message: "Controlled token read failure" }
              : tokenState;
        } else if (url.pathname === prefix + "/token/draft") {
          assert.equal(route.request().method(), "PUT");
          status = 409;
          json = { error: "TOKEN_DRAFT_CONFLICT", message: "Controlled version conflict" };
        }
      }
      if (url.pathname === "/api/v1/studio/perpl/markets") {
        const network = url.searchParams.get("network");
        if (!["testnet", "mainnet"].includes(network)) {
          errors.push(`Unexpected catalogue network: ${network}`);
          return route.abort();
        }
        catalogueCounts.set(network, (catalogueCounts.get(network) ?? 0) + 1);
        if (cataloguePhase === "failed") {
          status = 503;
          json = { error: "UNAVAILABLE", message: "Controlled catalogue failure" };
        } else {
          json = {
            network,
            observedAt: Date.now() + clientClockOffset,
            markets: ["BTC", "ETH", "SOL"].map((symbol, index) => ({
              marketId: 16 * (index + 1),
              symbol,
              name: `${symbol} Perp`,
              collateral: { symbol: "AUSD", decimals: 6 },
              status: "open",
              available: true,
              reasons: [],
            })),
          };
        }
      }
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
    if (scenario === "studio-markets") {
      await page.clock.install();
    }
    page.on("pageerror", (error) => errors.push(error.message));
    const route =
      scenario === "studio-token"
        ? `/studio/agents/${tokenAgentId}/token`
        : scenario.startsWith("studio")
          ? "/studio"
          : `/${scenario}`;
    await page.goto(`${base}${route}`);
    if (scenario === "studio-token") {
      const name = page.getByRole("textbox", { name: "Token name", exact: true });
      await page.getByRole("status", { name: "Loading token" }).waitFor();
      const field = await name.elementHandle();
      await name.fill("Kept during reads");
      assert.equal(
        await page.getByRole("button", { name: "Save draft", exact: true }).isDisabled(),
        true,
      );
      tokenPhase = "failed";
      releaseToken();
      await page.getByText("Token status could not be read.", { exact: true }).waitFor();
      assert.equal(await field.evaluate((node) => node.isConnected), true);
      assert.equal(await name.inputValue(), "Kept during reads");
      assert.equal(counts.get(`/api/v1/studio/agents/${tokenAgentId}/token`), 1);
      tokenPhase = "ready";
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("button", { name: "Use saved draft", exact: true }).waitFor();
      assert.equal(await name.inputValue(), "Kept during reads");
      await page.getByRole("button", { name: "Use saved draft", exact: true }).click();
      assert.equal(await name.inputValue(), "Saved token");
      await name.fill("Kept after save conflict");
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByRole("button", { name: "Reload state", exact: true }).waitFor();
      assert.equal(await name.inputValue(), "Kept after save conflict");
      tokenState.draft = { ...tokenState.draft, version: 2, name: "Newer saved token" };
      await page.getByRole("button", { name: "Reload state", exact: true }).click();
      await page.getByRole("button", { name: "Use saved draft", exact: true }).waitFor();
      assert.equal(await name.inputValue(), "Kept after save conflict");
      assert.equal(
        await page.getByRole("button", { name: "Save draft", exact: true }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Use saved draft", exact: true }).click();
      assert.equal(await name.inputValue(), "Newer saved token");
      assert.equal(
        await page.getByRole("button", { name: "Review launch", exact: true }).count(),
        0,
      );
    } else if (scenario === "studio-missing-wallet") {
      await page.waitForURL("**/signup?step=passkey&next=%2Fstudio");
    } else if (scenario === "studio-error") {
      await page.getByText(/Controlled load failure/).waitFor();
      await page.getByRole("button", { name: /try again/i }).waitFor();
    } else if (scenario === "studio-markets") {
      const panel = page.getByRole("region", { name: "Trading markets" });
      const name = page.getByRole("textbox", { name: "Name it", exact: true });
      await page.getByRole("textbox", { name: "Its handle", exact: true }).fill("loadingcheck");
      await name.fill("Preserved creator input");
      const selector = panel.getByRole("button", { name: "Select trading markets" });
      await selector.click();
      await page.getByRole("menuitemcheckbox", { name: "ETH", exact: true }).click();
      await page.keyboard.press("Escape");
      await panel.getByRole("button", { name: "ETH · Remove", exact: true }).waitFor();
      assert.equal(catalogueCounts.get("testnet"), 1);
      // Expire the real client timer without waiting thirty seconds or changing the UI.
      clientClockOffset = 31_000;
      await page.clock.fastForward(clientClockOffset);
      await panel.getByRole("alert").waitFor();
      cataloguePhase = "failed";
      await panel.getByRole("button", { name: "Retry catalogue" }).click();
      await panel.getByRole("alert").waitFor();
      assert.equal(await selector.isDisabled(), true);
      assert.equal(await name.inputValue(), "Preserved creator input");
      assert.equal(await panel.getByRole("button", { name: "ETH · Remove" }).count(), 1);
      assert.equal(catalogueCounts.get("testnet"), 2);
      cataloguePhase = "ready";
      await panel.getByRole("button", { name: "Retry catalogue" }).click();
      await selector.waitFor();
      assert.equal(await selector.isEnabled(), true);
      assert.equal(await name.inputValue(), "Preserved creator input");
      assert.equal(await panel.getByRole("button", { name: "ETH · Remove" }).count(), 1);
      assert.equal(catalogueCounts.get("testnet"), 3);
    } else if (scenario === "studio-wallets") {
      await page.getByTitle("Master wallet", { exact: true }).click();
      const modal = page.locator("#new-agent-wallets");
      await modal.getByText("MONAD TESTNET", { exact: true }).waitFor();
      await modal.getByRole("button", { name: "Add funds to agent" }).click();
      await modal.getByRole("button", { name: "All wallets" }).waitFor();
      assert.equal(await modal.locator('[data-master="true"]').count(), 0);
      const route = modal.getByLabel("Transfer route");
      await route.getByText("Master wallet", { exact: true }).waitFor();
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
      await page.waitForFunction(
        () =>
          document.querySelector(
            '[aria-label="Trading markets"] button[aria-label="Select trading markets"]',
          )?.disabled === false,
      );
      assert.equal(catalogueCounts.get("mainnet"), 1);
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
      if (endpoint === "/api/v1/studio/perpl/markets" && scenario === "studio-markets") {
        maximum = 3;
      } else if (scenario === "studio-token") {
        maximum = 3;
      } else if (scenario === "studio-wallets" && walletRead) {
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

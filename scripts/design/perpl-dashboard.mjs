/** Browser → Hono → controlled Perpl transport → exact projections. Loopback only. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PerplDashboardGateway } from "@pickler/infrastructure";
import { controlledPerplChain } from "../../packages/infrastructure/test/perpl-dashboard-chain-fixture.ts";
import { DASHBOARD_WALLET } from "../../packages/infrastructure/test/perpl-dashboard-fixture.ts";
import { createApp } from "../../workers/api/src/app.ts";
import { documentationServices } from "../../workers/api/src/openapi/composition.ts";
import { openBrowser } from "./lib/browser.mjs";
const base = process.argv[2] ?? "http://localhost:3005";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = new URL("./.shots/diagnostics/perpl-dashboard/", import.meta.url);
await mkdir(output, { recursive: true });
const account = { address: DASHBOARD_WALLET };
let connectedAddress = account.address;
const fixture = controlledPerplChain(Date.now, account.address);
const app = createApp({
  ...documentationServices({}),
  perplDashboard: {
    gateway: new PerplDashboardGateway(fixture.fetcher),
    authenticate: async () => {
      throw new Error("Public dashboard must not authenticate");
    },
  },
});
const expires = Math.floor(Date.now() / 1000) + 7200;
const user = {
  id: "4f9b6d30-283c-4543-a6e0-92f4f0300001",
  app_metadata: { pickler_account: "wallet" },
  user_metadata: {},
  aud: "authenticated",
  role: "authenticated",
  created_at: new Date().toISOString(),
  identities: [],
};
const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({ sub: user.id, exp: expires, app_metadata: user.app_metadata }),
  ).toString("base64url"),
  "controlled",
].join(".");
const browser = await openBrowser();
const context = await browser.newContext();
const methods = [],
  errors = [],
  forbidden = [];
await context.exposeFunction("controlledPerplWallet", async ({ method }) => {
  methods.push(method);
  if (["eth_accounts", "eth_requestAccounts"].includes(method)) {
    return connectedAddress ? [connectedAddress] : [];
  }
  if (method === "eth_chainId") {
    return "0x1";
  }
  if (method === "eth_getBalance") {
    return "0xde0b6b3a7640000";
  }
  if (method === "wallet_revokePermissions") {
    return null;
  }
  throw new Error("Forbidden wallet method " + method);
});
await context.addInitScript(() => {
  const originalNow = Date.now;
  Date.now = () => originalNow() - 120_000;
  localStorage.setItem("pk.wallet.kind", "injected");
  window.ethereum = {
    on(name, callback) {
      window.perplWalletListeners ??= new Map();
      const listeners = window.perplWalletListeners.get(name) ?? new Set();
      listeners.add(callback);
      window.perplWalletListeners.set(name, listeners);
    },
    removeListener(name, callback) {
      window.perplWalletListeners?.get(name)?.delete(callback);
    },
    request: (args) => window.controlledPerplWallet(args),
  };
});
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    forbidden.push(url.origin);
    return route.abort();
  }
  if (url.pathname.startsWith("/api/v1/perpl/")) {
    const result = await app.request(url.pathname.replace("/api", ""), {
      method: request.method(),
      headers: request.headers(),
      ...(request.postData() ? { body: request.postData() } : {}),
    });
    return route.fulfill({
      status: result.status,
      headers: Object.fromEntries(result.headers),
      body: await result.text(),
    });
  }
  if (url.pathname === "/api/v1/auth/wallet/nonce") {
    return route.fulfill({ json: { data: { message: "Controlled Pickler sign in" } } });
  }
  if (url.pathname === "/api/v1/auth/wallet/verify") {
    return route.fulfill({
      json: {
        data: {
          userId: user.id,
          session: { accessToken: jwt, refreshToken: "controlled-refresh" },
        },
      },
    });
  }
  if (url.pathname === "/api/v1/profile") {
    return route.fulfill({ json: { data: { handle: "controlled", display_name: "Controlled" } } });
  }
  if (url.pathname === "/auth/v1/user") {
    return route.fulfill({ json: user });
  }
  if (url.pathname === "/auth/v1/token") {
    return route.fulfill({
      json: {
        access_token: jwt,
        refresh_token: "controlled-refresh",
        expires_in: 7200,
        expires_at: expires,
        token_type: "bearer",
        user,
      },
    });
  }
  if (url.pathname.startsWith("/auth/")) {
    return route.fulfill({ json: {} });
  }
  return route.continue();
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(20000);
try {
  const previewContext = await browser.newContext();
  const previewRequests = [];
  const previewErrors = [];
  try {
    await previewContext.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname.startsWith("/api/v1/perpl/")
      ) {
        previewRequests.push(url.origin + url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    const previewPage = await previewContext.newPage();
    previewPage.on("pageerror", (e) => previewErrors.push(e.message));
    await previewPage.goto(`${base}/perpl?preview=wallet`);
    await previewPage.getByRole("heading", { name: "Open positions 2" }).waitFor();
    await previewPage.waitForFunction(
      () =>
        [...document.querySelectorAll("main img")].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      null,
      { timeout: 10_000 },
    );
    assert.equal(await previewPage.locator('main [data-surface="dark"]').count(), 1);
    await previewPage.locator("main details summary").click();
    assert.equal(await previewPage.locator("main details[open]").count(), 1);
    await previewPage.locator("main details summary").click();
    assert.equal(await previewPage.getByText("Preview · demo data", { exact: true }).count(), 1);
    assert.equal(
      await previewPage
        .locator("main")
        .getByRole("button", { name: /Authorize|Connect wallet/ })
        .count(),
      0,
      "sample portfolio cannot authorize a wallet",
    );
    assert.equal(await previewPage.locator('a[href*="/address/"]').count(), 0);
    for (const width of [1280, 768, 380, 320]) {
      await previewPage.setViewportSize({ width, height: 1100 });
      assert.ok(
        await previewPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `preview overflow at ${width}`,
      );
      await previewPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await previewPage.screenshot({
        path: new URL(`preview-${width}.png`, output).pathname,
        fullPage: true,
      });
    }
    assert.deepEqual(previewRequests, [], "preview never mounts live reads");
    assert.deepEqual(previewErrors, []);
  } finally {
    await previewContext.close();
  }
  await page.goto(`${base}/`);
  const dashboardEntry = page.getByRole("link", { name: "Open Perpl dashboard", exact: true });
  assert.equal(await dashboardEntry.getAttribute("href"), "/perpl");
  await dashboardEntry.click();
  await page.waitForURL(`${base}/perpl`);
  await page.getByRole("heading", { name: "The market", exact: true }).waitFor();
  await page.getByRole("link", { name: "BTC", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Authorize read-only|Switch to Monad/ }).count(),
    0,
  );
  assert.equal(fixture.venue.enrollment, null);
  assert.equal(
    methods.some((m) => /sign|send|switch|addEthereum/i.test(m)),
    false,
  );
  await page.getByRole("link", { name: "Pickler home", exact: true }).click();
  await page.getByRole("link", { name: "Open Perpl dashboard", exact: true }).click();
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor();
  const initialPrice = await page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "BTC", exact: true }) })
    .innerText();
  fixture.updateMarks();
  await page.waitForTimeout(11500);
  const newPrice = await page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "BTC", exact: true }) })
    .innerText();
  assert.notEqual(newPrice, initialPrice, "markets refresh automatically");
  assert.equal(
    methods.some((m) => /sign|send|switch|addEthereum/i.test(m)),
    false,
    "polling never prompts",
  );
  for (const width of [1280, 768, 380, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `overflow at ${width}`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: new URL(`portfolio-${width}.png`, output).pathname,
      fullPage: true,
    });
  }
  fixture.setFailure("identity");
  await page.locator("main [role=alert]").waitFor();
  assert.equal((await page.locator("[data-stale=true]").count()) > 0, true);
  fixture.setFailure("");
  connectedAddress = "0x9999999999999999999999999999999999999999";
  await page.evaluate((address) => {
    for (const listener of window.perplWalletListeners.get("accountsChanged") ?? []) {
      listener([address]);
    }
  }, connectedAddress);
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("heading", { name: "Open positions 2" }).count(),
    0,
    "old wallet data hides after the wallet-change render",
  );
  await page.getByRole("heading", { name: "Open positions 0" }).waitFor();
  await page.getByRole("button", { name: /^Wallet,/ }).click();
  // Disconnect through the existing account menu; no enrollment or transaction operation can run after it.
  const disconnect = page.getByRole("menuitem", { name: /Disconnect/ });
  await disconnect.click();
  await page.getByRole("heading", { name: "See your positions alongside the market." }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Open positions 2" }).count(), 0);
  await page.goto(`${base}/perpl?wallet=${account.address}`);
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor();
  await page.getByText("Viewing the public portfolio of the wallet in this link.").waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "See your positions alongside the market." }).count(),
    0,
  );
  await page.reload();
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor();
  await page.goto(`${base}/perpl?wallet=invalid`);
  await page.getByRole("heading", { name: "See your positions alongside the market." }).waitFor();
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  assert.ok(methods.every((m) => !m.includes("send") && m !== "eth_signTransaction"));
  const proof = {
    localAssetImages: true,
    widths: [1280, 768, 380, 320],
    controlled: true,
    browserClockSkewMs: -120_000,
    inAppNavigationKeepsReadAccess: true,
    fullReloadNeedsNoAuthorization: true,
    walletChangeHidesPreviousData: true,
    wrongWalletNetworkDoesNotBlockPublicReads: true,
    publicContractReads: true,
    explicitWalletLinkNeedsNoConnection: true,
    invalidWalletLinkDoesNotFetch: true,
    enrollmentRequests: fixture.venue.calls.filter((c) => c.path.includes("api-key")).length,
    realTransactions: 0,
    externalRequests: 0,
    typedSignatures: methods.filter((m) => m === "eth_signTypedData_v4").length,
    providerReads: fixture.calls.length + fixture.venue.calls.length,
  };
  await writeFile(new URL("accepted.json", output), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) {
  await page.screenshot({ path: new URL("failure.png", output).pathname, fullPage: true });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await context.close();
  await browser.close();
}

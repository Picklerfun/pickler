/** Browser → Hono → controlled Perpl transport → exact projections. Loopback only. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashTypedData, hexToBytes } from "viem";
import { PerplDashboardGateway } from "../../packages/infrastructure/src/perpl/dashboard.ts";
import { controlledPerpl } from "../../packages/infrastructure/test/perpl-dashboard-fixture.ts";
import { createApp } from "../../workers/api/src/app.ts";
import { documentationServices } from "../../workers/api/src/openapi/composition.ts";
import { openBrowser } from "./lib/browser.mjs";
const base = process.argv[2] ?? "http://localhost:3005";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = new URL("./.shots/diagnostics/perpl-dashboard/", import.meta.url);
await mkdir(output, { recursive: true });
const account = privateKeyToAccount(generatePrivateKey());
assert.match(account.address, /^0x[0-9a-fA-F]{40}$/);
const fixture = controlledPerpl(Date.now, account.address);
const app = createApp({
  ...documentationServices({}),
  perplDashboard: {
    gateway: new PerplDashboardGateway(async (target, init) => {
      const url = new URL(String(target));
      if (url.pathname.includes("/trading/")) {
        assert.ok(fixture.enrollment);
        const headers = new Headers(init.headers);
        const key = await webcrypto.subtle.importKey(
          "raw",
          Buffer.from(fixture.enrollment.typed_data.message.publicKey, "base64url"),
          "Ed25519",
          false,
          ["verify"],
        );
        const canonical = [
          10143,
          "GET",
          url.pathname.replace("/api", ""),
          headers.get("X-API-Timestamp"),
          headers.get("X-API-Nonce"),
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ].join("\n");
        assert.equal(
          await webcrypto.subtle.verify(
            "Ed25519",
            key,
            Buffer.from(headers.get("X-API-Signature"), "base64url"),
            new TextEncoder().encode(canonical),
          ),
          true,
          "each account read needs a valid fresh signature",
        );
      }
      return fixture.fetcher(target, init);
    }),
    authenticate: async (input) => {
      assert.ok(input.bearerToken, "portfolio needs the Pickler JWT");
      return { principal: { kind: "user", userId: "controlled" }, workspace: null };
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
let cancelled = true;
await context.exposeFunction("controlledPerplWallet", async ({ method, params }) => {
  methods.push(method);
  if (["eth_accounts", "eth_requestAccounts"].includes(method)) {
    return [account.address];
  }
  if (method === "eth_chainId") {
    return "0x279f";
  }
  if (method === "eth_getBalance") {
    return "0xde0b6b3a7640000";
  }
  if (method === "personal_sign") {
    return account.signMessage({ message: { raw: params[0] } });
  }
  if (method === "eth_signTypedData_v4") {
    if (cancelled) {
      throw Object.assign(new Error("Request rejected by the user"), { code: 4001 });
    }
    const data = JSON.parse(params[1]);
    assert.equal(data.message.scope, "1");
    assert.equal(data.types.EIP712Domain.length, 5, "browser EIP-712 RPC includes its domain type");
    assert.equal(data.message.builderId, "0");
    assert.equal(data.message.maxBuilderFeePer100K, "0");
    return account.signTypedData(data);
  }
  if (method === "wallet_revokePermissions") {
    return null;
  }
  throw new Error("Forbidden wallet method " + method);
});
await context.addInitScript(() => {
  localStorage.setItem("pk.wallet.kind", "injected");
  window.ethereum = {
    on() {},
    removeListener() {},
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
  await page.goto(`${base}/perpl`);
  await page.getByRole("heading", { name: "The market", exact: true }).waitFor();
  await page.getByRole("link", { name: "BTC", exact: true }).waitFor();
  await page.getByRole("button", { name: "Authorize read-only access", exact: true }).click();
  await page.locator("main [role=alert]").waitFor();
  assert.equal(
    fixture.calls.filter((c) => c.path.endsWith("/api-key/enroll")).length,
    0,
    "cancelled signature never enrolls",
  );
  cancelled = false;
  await page.getByRole("button", { name: "Authorize read-only access", exact: true }).click();
  await page.getByRole("heading", { name: "Open positions 2" }).waitFor();
  const enrolled = fixture.enrollment;
  assert.ok(enrolled);
  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(enrolled.typed_data.message.publicKey, "base64url"),
    "Ed25519",
    false,
    ["verify"],
  );
  const types = { PerplRegisterApiKey: enrolled.typed_data.types.PerplRegisterApiKey };
  assert.equal(
    await webcrypto.subtle.verify(
      "Ed25519",
      key,
      Buffer.from(enrolled.pop_signature.slice(2), "hex"),
      hexToBytes(
        hashTypedData({
          ...enrolled.typed_data,
          types,
          domain: { ...enrolled.typed_data.domain, chainId: 10143 },
          message: {
            ...enrolled.typed_data.message,
            time: BigInt(enrolled.typed_data.message.time),
          },
        }),
      ),
    ),
    true,
  );
  assert.equal(methods.filter((m) => m === "eth_signTypedData_v4").length, 2);
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
    methods.filter((m) => m === "eth_signTypedData_v4").length,
    2,
    "polling never prompts again",
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
  fixture.setWrongWallet(true);
  await page.locator("main [role=alert]").waitFor();
  assert.equal((await page.locator("[data-stale=true]").count()) > 0, true);
  fixture.setWrongWallet(false);
  await page.getByRole("button", { name: /^Wallet,/ }).click();
  // Disconnect through the existing account menu; no enrollment or transaction operation can run after it.
  const disconnect = page.getByRole("menuitem", { name: /Disconnect/ });
  await disconnect.click();
  await page.getByRole("heading", { name: "See your positions alongside the market." }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Open positions 2" }).count(), 0);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  assert.ok(methods.every((m) => !m.includes("send") && m !== "eth_signTransaction"));
  const proof = {
    widths: [1280, 768, 380, 320],
    controlled: true,
    realTransactions: 0,
    externalRequests: 0,
    typedSignatures: methods.filter((m) => m === "eth_signTypedData_v4").length,
    providerReads: fixture.calls.length,
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

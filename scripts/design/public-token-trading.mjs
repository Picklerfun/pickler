/** Loopback-only visitor acceptance. Every API/RPC response and wallet is controlled. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, erc20Abi } from "viem";
import { AUSD, MONAD_TESTNET, PicklerBondingCurveAbi } from "@pickler/chain";
import { openBrowser } from "./lib/browser.mjs";
import { start, BASE_URL, FIXTURE_PORT, WEB_PORT, listening } from "./lib/servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.argv[2] ?? BASE_URL;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = path.join(root, "scripts/design/.shots/diagnostics/public-token-trading");
mkdirSync(output, { recursive: true });
const quotes = JSON.parse(
  readFileSync(path.join(root, "apps/web/src/features/tokens/trade-quotes.json")),
);
const wallet = "0x5555555555555555555555555555555555555555";
const token = "0x1111111111111111111111111111111111111111";
const curve = "0x3333333333333333333333333333333333333333";
const hash = "0x" + "a".repeat(64);
const errors = [],
  forbidden = [];
let servers, browser, page;
try {
  if (!process.argv[2]) {
    assert.equal(
      await listening(FIXTURE_PORT),
      false,
      "Fixture port is busy; supply an explicit loopback URL.",
    );
    assert.equal(
      await listening(WEB_PORT),
      false,
      "Web port is busy; supply an explicit loopback URL.",
    );
    servers = await start(root, path.join(output, "servers.log"));
  }
  browser = await openBrowser();
  const context = await browser.newContext();
  let reads = 0,
    approved = false,
    refusal = false;
  await context.addInitScript(
    ({ wallet, hash }) => {
      localStorage.setItem("pk.wallet.kind", "injected");
      window.__sent = [];
      window.__uncertain = false;
      window.ethereum = {
        on() {},
        removeListener() {},
        async request({ method, params }) {
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [wallet];
          }
          if (method === "eth_chainId") {
            return "0x279f";
          }
          if (method === "eth_getBalance") {
            return "0xde0b6b3a7640000";
          }
          if (method === "eth_getTransactionCount") {
            return "0x0";
          }
          if (method === "eth_call") {
            return "0x";
          }
          if (method === "eth_sendTransaction") {
            window.__sent.push(params[0]);
            if (window.__uncertain) {
              throw Object.assign(new Error("response lost"), { code: -32000 });
            }
            return hash;
          }
          throw new Error(`Unexpected wallet method ${method}`);
        },
      };
    },
    { wallet, hash },
  );
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/v1/marketplace/personas/public_trade/token/prepare") {
      reads++;
      assert.equal(request.method(), "POST");
      assert.equal(request.headers().authorization, undefined);
      if (refusal) {
        return route.fulfill({ status: 429, json: { error: "RPC_LIMIT" } });
      }
      const input = request.postDataJSON();
      assert.equal(input.wallet, wallet);
      const quote = { ...quotes[input.side], approval: !approved };
      assert.equal(input.amount, quote.amount);
      assert.equal(input.slippageBps, quote.slippageBps);
      const expiry = Math.floor(Date.now() / 1000) + 300;
      const asset = input.side === "buy" ? AUSD[10143].address : token;
      const data = quote.approval
        ? encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [curve, BigInt(input.amount)],
          })
        : encodeFunctionData({
            abi: PicklerBondingCurveAbi,
            functionName: input.side === "buy" ? "buyExactInput" : "sellExactInput",
            args: [BigInt(input.amount), BigInt(quote.minimumOutput), wallet, BigInt(expiry)],
          });
      return route.fulfill({
        json: {
          version: 1,
          token,
          curve,
          quoteToken: AUSD[10143].address,
          expiresAt: new Date(expiry * 1000).toISOString(),
          quote,
          transaction: {
            from: wallet,
            to: quote.approval ? asset : curve,
            data,
            value: "0x0",
            chainId: 10143,
            nonce: 0,
            gas: "0x186a0",
            maxFeePerGas: "0x3b9aca00",
            maxPriorityFeePerGas: "0x3b9aca00",
          },
        },
      });
    }
    if (url.pathname.startsWith("/api/v1/handles/") && url.pathname.endsWith("/availability")) {
      const handle = url.pathname.split("/")[4];
      return route.fulfill({ json: { data: { available: handle !== "gilbertsahumada" } } });
    }
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      // A status check uses the public wallet RPC, but this harness never contacts it.
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      const result =
        body?.method === "eth_getTransactionReceipt"
          ? { transactionHash: hash, status: "0x1", blockNumber: "0x64", blockHash: hash }
          : body?.method === "eth_getBlockByNumber"
            ? { hash }
            : body?.method === "eth_blockNumber"
              ? "0x66"
              : undefined;
      if (url.href === MONAD_TESTNET.publicRpcUrls[1] && result !== undefined) {
        return route.fulfill({ json: { jsonrpc: "2.0", id: 1, result } });
      }
      forbidden.push(url.toString());
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      forbidden.push(url.toString());
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1280, 380, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/agents/halftime?stage=token-empty&wallet=username`);
    const username = page.getByRole("textbox", { name: "Username", exact: true });
    await username.fill("gilbertsahumada");
    const another = page.getByRole("button", { name: "Choose another username", exact: true });
    await another.waitFor();
    assert.equal(await username.isEnabled(), true);
    assert.equal(
      await page.getByRole("button", { name: "Claim it", exact: true }).isDisabled(),
      true,
    );
    await another.focus();
    await page.keyboard.press("Enter");
    assert.equal(await username.inputValue(), "");
    assert.equal(await username.evaluate((el) => document.activeElement === el), true);
    await username.fill("gilbert_new");
    await page.getByText("AVAILABLE", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Claim it", exact: true }).isEnabled(),
      true,
    );
    await page.screenshot({ path: path.join(output, `username-${width}.png`) });
    await page.goto(`${base}/agents/halftime?stage=token-launched`);
    const trade = page.getByRole("region", { name: "Trade token publicly" });
    await trade.getByRole("button", { name: "Review buy", exact: true }).click();
    await trade.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await trade.getByRole("textbox", { name: "Public amount · AUSD", exact: true }).inputValue(),
      "1",
    );
    for (const side of ["buy", "sell"]) {
      await trade
        .getByRole("button", { name: side === "buy" ? "Buy" : "Sell", exact: true })
        .click();
      for (let step = 0; step < 2; step++) {
        await trade.getByRole("button", { name: `Review ${side}`, exact: true }).click();
        await trade.getByRole("button", { name: "Simulate confirmation", exact: true }).click();
        await trade.getByRole("button", { name: "Check transaction", exact: true }).click();
      }
      await trade.getByText("Trade confirmed.", { exact: true }).waitFor();
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await trade.screenshot({ path: path.join(output, `public-${width}.png`) });
  }
  await page.goto(`${base}/agents/public_trade`);
  const trade = page.getByRole("region", { name: "Trade token publicly" });
  await trade.getByRole("button", { name: "Review buy", exact: true }).waitFor();
  assert.equal(reads, 0, "no background quote requests");
  refusal = true;
  await trade.getByRole("button", { name: "Review buy", exact: true }).click();
  await trade.getByRole("alert").waitFor();
  assert.equal(
    await trade.getByRole("textbox", { name: "Public amount · AUSD", exact: true }).inputValue(),
    "1",
  );
  refusal = false;
  await trade.getByRole("button", { name: "Review buy", exact: true }).click();
  await trade.getByRole("button", { name: "Approve in wallet", exact: true }).click();
  await trade.getByRole("button", { name: "Check transaction", exact: true }).waitFor();
  await page.reload();
  await trade.getByRole("button", { name: "Check transaction", exact: true }).click();
  await trade.getByText("Approval confirmed. Review the trade again.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__sent.length), 0, "reload did not send again");
  approved = true;
  await trade.getByRole("button", { name: "Review buy", exact: true }).click();
  await trade.screenshot({ path: path.join(output, "visitor-review.png") });
  await trade.getByRole("button", { name: "Confirm buy in wallet", exact: true }).click();
  await trade.getByRole("button", { name: "Check transaction", exact: true }).click();
  await trade.getByText("Trade confirmed.", { exact: true }).waitFor();
  const sent = await page.evaluate(() => window.__sent);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, wallet);
  assert.equal(sent[0].to, curve);
  await trade.getByRole("button", { name: "Sell", exact: true }).click();
  await trade.getByRole("button", { name: "Review sell", exact: true }).click();
  await page.evaluate(() => {
    window.__uncertain = true;
  });
  await trade.getByRole("button", { name: "Confirm sell in wallet", exact: true }).click();
  await trade.getByRole("alert").waitFor();
  assert.equal(
    await trade.getByRole("button", { name: "Check transaction", exact: true }).isDisabled(),
    true,
  );
  await page.reload();
  assert.equal(await trade.getByRole("button", { name: "Review sell", exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.__sent.length),
    0,
    "uncertain submission is not retried",
  );
  assert.equal(
    await trade.getByRole("textbox", { name: "Public amount · HALF", exact: true }).inputValue(),
    "1000",
    "restored sell retains its asset and amount",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  writeFileSync(
    path.join(output, "accepted.json"),
    JSON.stringify(
      { widths: [1280, 380, 320], reads, simulated: true, realTransactions: 0 },
      null,
      2,
    ),
  );
  console.log(
    "PASS: taken username recovery, public buy/sell, explicit requests, bounded errors and no duplicate sends",
  );
} catch (error) {
  writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ url: page?.url(), errors, forbidden, error: String(error) }, null, 2),
  );
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  servers?.stop();
}

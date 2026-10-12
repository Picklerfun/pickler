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
const blockHash = "0x" + "a".repeat(64);
const broadcasts = new Map();
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
  let confirmations = 0;
  let quoteReads = 0;
  let delayedQuote = false;
  let reads = 0,
    nonce = 0,
    holdReceipts = false,
    transientReceiptFailure = false,
    refusal = false;
  const approved = { buy: false, sell: false };
  await context.addInitScript(
    ({ wallet }) => {
      if (!sessionStorage.getItem("pk.controlled.visited")) {
        localStorage.setItem("pk.wallet.kind", "injected");
        sessionStorage.setItem("pk.controlled.visited", "yes");
      }
      window.__walletRequests = [];
      window.__sent = [];
      window.__uncertain = false;
      window.__cancel = false;
      window.__nonce = Number(sessionStorage.getItem("pk.controlled.nonce") ?? "0");
      window.ethereum = {
        on() {},
        removeListener() {},
        async request({ method, params }) {
          window.__walletRequests.push(method);
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
            return "0x" + window.__nonce.toString(16);
          }
          if (method === "eth_call") {
            return "0x";
          }
          if (method === "eth_sendTransaction") {
            if (window.__cancel) {
              throw Object.assign(new Error("cancelled"), { code: 4001 });
            }
            const hash = "0x" + (window.__nonce + 1).toString(16).padStart(64, "0");
            window.__sent.push(params[0]);
            await fetch("/__controlled/wallet", {
              method: "POST",
              body: JSON.stringify({ hash, transaction: params[0] }),
            });
            window.__nonce += 1;
            sessionStorage.setItem("pk.controlled.nonce", String(window.__nonce));
            if (window.__uncertain) {
              throw Object.assign(new Error("response lost"), { code: -32000 });
            }
            return hash;
          }
          throw new Error(`Unexpected wallet method ${method}`);
        },
      };
    },
    { wallet },
  );
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/__controlled/wallet") {
      const { hash, transaction } = request.postDataJSON();
      assert.equal(Number(BigInt(transaction.nonce)), nonce);
      nonce += 1;
      broadcasts.set(hash, transaction);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === `/api/v1/launches/${encodeURIComponent(`eip155:10143:${token}`)}`) {
      assert.equal(request.method(), "GET");
      return route.continue();
    }
    if (url.pathname === "/api/v1/marketplace/personas/public_trade/token/confirm") {
      assert.equal(request.method(), "POST");
      const input = request.postDataJSON();
      assert.deepEqual(Object.keys(input).sort(), ["txHash", "wallet"]);
      assert.equal(input.wallet, wallet);
      const tx = broadcasts.get(input.txHash);
      assert.ok(tx && tx.to.toLowerCase() === curve.toLowerCase());
      confirmations++;
      return route.fulfill({ json: { status: "confirmed" } });
    }
    if (url.pathname === "/api/v1/marketplace/personas/public_trade/token/quote") {
      quoteReads++;
      const input = request.postDataJSON();
      assert.equal(input.wallet, wallet);
      assert.equal(request.headers().authorization, undefined);
      const quote = { ...quotes[input.side], amount: input.amount, slippageBps: input.slippageBps };
      if (input.side === "buy" && input.amount === "2000000") {
        quote.expectedOutput = "3800000000000000000000";
        quote.minimumOutput = "3781000000000000000000";
        if (delayedQuote) {
          await new Promise((resolve) => setTimeout(resolve, 1400));
        }
      }
      if (input.side === "buy" && input.amount === "3000000") {
        quote.expectedOutput = "5700000000000000000000";
        quote.minimumOutput = "5671500000000000000000";
      }
      return route.fulfill({
        json: {
          version: 1,
          token,
          curve,
          quoteToken: AUSD[10143].address,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          quote,
        },
      });
    }
    if (url.pathname === "/api/v1/marketplace/personas/public_trade/token/prepare") {
      reads++;
      assert.equal(request.method(), "POST");
      assert.equal(request.headers().authorization, undefined);
      if (refusal) {
        return route.fulfill({ status: 429, json: { error: "RPC_LIMIT" } });
      }
      const input = request.postDataJSON();
      assert.equal(input.wallet, wallet);
      const quote = { ...quotes[input.side], approval: !approved[input.side] };
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
            nonce,
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
      // Strict controlled RPC: this harness never contacts a real provider.
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      let result;
      if (body?.method === "eth_getTransactionReceipt") {
        const tx = broadcasts.get(body.params[0]);
        assert.ok(tx, "receipt belongs to a single recorded broadcast");
        if (transientReceiptFailure) {
          transientReceiptFailure = false;
          return route.fulfill({ status: 503, json: { error: "controlled interruption" } });
        }
        if (holdReceipts) {
          result = null;
        } else {
          if (tx.to.toLowerCase() !== curve.toLowerCase()) {
            approved[tx.to.toLowerCase() === token.toLowerCase() ? "sell" : "buy"] = true;
          }
          result = {
            transactionHash: body.params[0],
            status: "0x1",
            blockNumber: "0x64",
            blockHash,
          };
        }
      } else if (body?.method === "eth_getBlockByNumber") {
        result = { hash: blockHash };
      } else if (body?.method === "eth_blockNumber") {
        result = "0x66";
      }
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
  page.setDefaultTimeout(15_000);
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
    for (const side of ["buy", "sell"]) {
      await trade
        .getByRole("button", { name: side === "buy" ? "Buy" : "Sell", exact: true })
        .click();
      await trade
        .getByRole("button", { name: `${side === "buy" ? "Buy" : "Sell"} HALF`, exact: true })
        .click();
      await trade
        .getByRole("button", { name: side === "buy" ? "Bought HALF" : "Sold HALF", exact: true })
        .waitFor();
      assert.equal(
        await trade.getByRole("button", { name: "Check transaction", exact: true }).count(),
        0,
      );
      assert.equal(await page.getByText("Loading market data…", { exact: true }).count(), 0);
      assert.equal(
        await trade.getByRole("button", { name: "Copy approval transaction", exact: true }).count(),
        1,
      );
      assert.equal(
        await trade.getByRole("button", { name: `Copy ${side} transaction`, exact: true }).count(),
        1,
      );
      assert.equal(
        await trade.getByRole("link").count(),
        0,
        "simulated receipts never open an explorer",
      );
      const action = trade.getByRole("button", {
        name: side === "buy" ? "Bought HALF" : "Sold HALF",
        exact: true,
      });
      assert.equal(
        (await action.boundingBox()).height,
        48,
        "compact primary action on every viewport",
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await trade.screenshot({ path: path.join(output, `public-${width}.png`) });
  }
  const previewTrade = page.getByRole("region", { name: "Trade token publicly" });
  for (const [scenario, result] of [
    ["Cancel", "Cancelled · try again"],
    ["Failure", "Retry buy"],
    ["Slow network", "Buying HALF"],
  ]) {
    await page.getByRole("button", { name: scenario, exact: true }).click();
    await previewTrade.getByRole("button", { name: "Buy", exact: true }).click();
    await previewTrade.getByRole("button", { name: "Buy HALF", exact: true }).click();
    await previewTrade.getByRole("button", { name: result, exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Success", exact: true }).click();
  await page.goto(`${base}/agents/public_trade`);
  const trade = page.getByRole("region", { name: "Trade token publicly" });
  await trade.getByRole("button", { name: "Buy HALF", exact: true }).waitFor();
  const estimate = trade.getByRole("definition").first();
  await estimate.getByText(/1,327\.492339/).waitFor();
  assert.equal(reads, 0, "background quotes never prepare transactions");
  assert.equal(broadcasts.size, 0, "showing a quote never broadcasts");
  const amountField = trade.getByRole("textbox", { name: "Public amount · AUSD", exact: true });
  const quotedBefore = quoteReads;
  await amountField.fill("2");
  await amountField.fill("3");
  await estimate.getByText(/5,700/).waitFor();
  assert.equal(quoteReads, quotedBefore + 1, "rapid edits are debounced");
  delayedQuote = true;
  await amountField.fill("2");
  await page.waitForRequest(
    (request) =>
      request.url().endsWith("/token/quote") && request.postDataJSON().amount === "2000000",
  );
  await amountField.fill("3");
  assert.equal(await estimate.getByText(/3,800/).count(), 0, "old amount clears immediately");
  await estimate.getByText(/5,700/).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(
    await estimate.getByText(/3,800/).count(),
    0,
    "late quote cannot replace the current amount",
  );
  delayedQuote = false;
  await amountField.fill("1");
  await estimate.getByText(/1,327\.492339/).waitFor();
  await trade.screenshot({ path: path.join(output, "visitor-live-estimate.png") });
  const readyBounds = await trade
    .getByRole("button", { name: "Buy HALF", exact: true })
    .boundingBox();
  const readyOffset = await trade
    .getByRole("button", { name: "Buy HALF", exact: true })
    .evaluate(
      (el) => el.getBoundingClientRect().top - el.closest("section").getBoundingClientRect().top,
    );
  refusal = true;
  await trade.getByRole("button", { name: "Buy HALF", exact: true }).click();
  await trade.getByRole("button", { name: "Retry buy", exact: true }).waitFor();
  assert.equal(
    await trade.getByRole("textbox", { name: "Public amount · AUSD", exact: true }).inputValue(),
    "1",
  );
  assert.equal(broadcasts.size, 0);
  refusal = false;
  holdReceipts = true;
  await trade.getByRole("button", { name: "Retry buy", exact: true }).click();
  const approvalButton = trade.getByRole("button", { name: "Approving AUSD", exact: true });
  await approvalButton.waitFor();
  assert.equal(await approvalButton.isDisabled(), true);
  const approvalBounds = await approvalButton.boundingBox();
  assert.equal(approvalBounds.height, readyBounds.height, "button height stays fixed");
  assert.equal(
    await approvalButton.evaluate(
      (el) => el.getBoundingClientRect().top - el.closest("section").getBoundingClientRect().top,
    ),
    readyOffset,
    "confirmation does not push the button down",
  );
  assert.ok(
    await approvalButton.evaluate((el) =>
      el.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"),
    ),
    "progress animates inside the button",
  );
  assert.equal(
    await trade.locator("p[role=status], p[role=alert]").count(),
    0,
    "no separate status or error paragraphs",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await approvalButton.evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
    "reduced motion disables button animation",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(await approvalButton.getAttribute("aria-busy"), "true");
  assert.equal(
    await trade.locator('[aria-busy="true"]').count(),
    1,
    "only the button shows loading",
  );
  assert.equal(
    await trade.getByRole("button", { name: "Check transaction", exact: true }).count(),
    0,
  );
  const approvalHash = [...broadcasts.keys()][0];
  const reference = trade.getByRole("link", {
    name: "View approval transaction in explorer",
    exact: true,
  });
  await reference.waitFor();
  assert.ok((await reference.getAttribute("href")).endsWith(`/tx/${approvalHash}`));
  await trade.screenshot({ path: path.join(output, "visitor-confirming-approval.png") });
  transientReceiptFailure = true;
  holdReceipts = false;
  await trade.getByRole("button", { name: "Bought HALF", exact: true }).waitFor();
  assert.ok(confirmations > 0, "server verifies the receipt before swap success");
  assert.equal(broadcasts.size, 2, "one click completes approval then purchase");
  assert.equal([...broadcasts.values()][1].to.toLowerCase(), curve.toLowerCase());
  const purchaseHash = [...broadcasts.keys()][1];
  const purchaseReference = trade.getByRole("link", {
    name: "View buy transaction in explorer",
    exact: true,
  });
  assert.ok((await reference.getAttribute("href")).endsWith(`/tx/${approvalHash}`));
  assert.ok((await purchaseReference.getAttribute("href")).endsWith(`/tx/${purchaseHash}`));
  assert.equal(await trade.getByRole("link").count(), 2);
  const copyApproval = trade.getByRole("button", {
    name: "Copy approval transaction",
    exact: true,
  });
  const copyPurchase = trade.getByRole("button", { name: "Copy buy transaction", exact: true });
  assert.equal(await copyApproval.innerText(), "", "copy remains icon-only");
  assert.equal(await copyPurchase.innerText(), "");
  await trade.screenshot({ path: path.join(output, "visitor-purchase-confirmed.png") });
  assert.equal(
    await trade.getByRole("button", { name: "Bought HALF", exact: true }).isDisabled(),
    true,
    "success cannot accidentally send another trade",
  );

  await page.reload();
  await purchaseReference.waitFor();
  assert.ok((await reference.getAttribute("href")).endsWith(`/tx/${approvalHash}`));
  assert.ok((await purchaseReference.getAttribute("href")).endsWith(`/tx/${purchaseHash}`));
  await trade.getByRole("button", { name: "Buy HALF", exact: true }).waitFor();
  assert.equal(broadcasts.size, 2, "completed receipts survive reload without another send");

  await trade.getByRole("button", { name: "Sell", exact: true }).click();
  await trade.getByRole("button", { name: "Sell HALF", exact: true }).click();
  await trade.getByRole("button", { name: "Sold HALF", exact: true }).waitFor();
  assert.equal(broadcasts.size, 4, "sale also continues approval then swap");

  await trade.getByRole("button", { name: "Buy", exact: true }).click();
  holdReceipts = true;
  await trade.getByRole("button", { name: "Buy HALF", exact: true }).click();
  await trade.getByRole("button", { name: "Buying HALF", exact: true }).waitFor();
  const pendingCount = broadcasts.size;
  await page.reload();
  await trade.getByRole("button", { name: "Buying HALF", exact: true }).waitFor();
  assert.equal(broadcasts.size, pendingCount, "reload reads the existing hash without sending");
  holdReceipts = false;
  await trade.getByRole("button", { name: "Bought HALF", exact: true }).waitFor();
  assert.equal(broadcasts.size, pendingCount);

  // Restoring an approval never opens a new wallet request from an effect.
  approved.sell = false;
  await trade.getByRole("button", { name: "Sell", exact: true }).click();
  holdReceipts = true;
  await trade.getByRole("button", { name: "Sell HALF", exact: true }).click();
  await trade.getByRole("button", { name: "Approving HALF", exact: true }).waitFor();
  const beforeRestore = broadcasts.size;
  await page.reload();
  await trade.getByRole("button", { name: "Approving HALF", exact: true }).waitFor();
  holdReceipts = false;
  await trade.getByRole("button", { name: "Confirm sell", exact: true }).waitFor();
  assert.equal(broadcasts.size, beforeRestore);
  await trade.getByRole("button", { name: "Confirm sell", exact: true }).click();
  await trade.getByRole("button", { name: "Sold HALF", exact: true }).waitFor();
  assert.equal(broadcasts.size, beforeRestore + 1);
  assert.equal(
    await trade.getByRole("link").count(),
    2,
    "resumed trade keeps the original approval",
  );
  assert.ok(
    (await reference.getAttribute("href")).endsWith(
      `/tx/${[...broadcasts.keys()][beforeRestore - 1]}`,
    ),
  );
  assert.ok(
    (
      await trade
        .getByRole("link", { name: "View sell transaction in explorer", exact: true })
        .getAttribute("href")
    ).endsWith(`/tx/${[...broadcasts.keys()][beforeRestore]}`),
  );

  await page.evaluate(() => {
    window.__cancel = true;
  });
  await trade.getByRole("button", { name: "Sell HALF", exact: true }).click();
  await trade.getByRole("button", { name: "Cancelled · try again", exact: true }).waitFor();
  const beforeCancel = broadcasts.size;
  await trade.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(broadcasts.size, beforeCancel);
  assert.equal(
    await trade.getByRole("textbox", { name: "Public amount · HALF", exact: true }).inputValue(),
    "1000",
  );

  await page.evaluate(() => {
    window.__cancel = false;
    window.__uncertain = true;
  });
  await trade.getByRole("button", { name: "Sell HALF", exact: true }).click();
  await trade.getByRole("button", { name: "Wallet response lost", exact: true }).waitFor();
  assert.equal(
    await trade.getByRole("button", { name: "Wallet response lost", exact: true }).isDisabled(),
    true,
  );
  const uncertainCount = broadcasts.size;
  await page.reload();
  await trade.getByRole("button", { name: "Wallet response lost", exact: true }).waitFor();
  assert.equal(broadcasts.size, uncertainCount, "uncertain submission is not retried");
  assert.equal(
    await trade.getByRole("textbox", { name: "Public amount · HALF", exact: true }).inputValue(),
    "1000",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  writeFileSync(
    path.join(output, "accepted.json"),
    JSON.stringify(
      {
        widths: [1280, 380, 320],
        reads,
        controlledBroadcasts: broadcasts.size,
        simulated: true,
        realTransactions: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: username recovery, continuous approvals/buy/sell, automatic receipt recovery, reload and no duplicate sends",
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

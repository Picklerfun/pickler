import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createPrivateKey, createPublicKey, verify, createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, erc20Abi, keccak256, parseTransaction, type Hex } from "viem";
import {
  emptyPerplLiveDocument,
  type PerplLiveAuthority,
  type PerplLiveSetup,
} from "@pickler/trading/perpl-live";
import { createPerplLiveDriver } from "../src/perpl/live-driver.js";

// Public controlled test key. Every HTTP/RPC operation below uses the injected local transport.
const owner = privateKeyToAccount(`0x${"0".repeat(62)}01`);
async function fixture(
  maxFeePerGasWei = "100",
  proxy: "none" | "reviewed" | "unreviewed" = "none",
) {
  const context = JSON.parse(
    await readFile(
      new URL("../../perpl-context/test/fixtures/context.json", import.meta.url),
      "utf8",
    ),
  );
  const authority: PerplLiveAuthority = {
    scope: { userId: randomUUID(), productAgentId: randomUUID() },
    tenantId: "controlled",
    agentId: "controlled",
    address: owner.address.toLowerCase(),
    organizationId: "controlled",
    configVersion: 1,
    enabled: true,
    paused: false,
    killed: false,
    network: "testnet",
    markets: ["BTC"],
    perCallMicros: "10000000",
    perDayMicros: "100000000",
  };
  const document = emptyPerplLiveDocument(authority.address, authority.scope.productAgentId);
  let accountIdentifier = 0n;
  let venueRead: typeof fetch | undefined;
  let forwards = 0;
  let reads = 0;
  let sends = 0;
  let nonce = "0x0";
  const implementationSlot = "360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  let code = proxy === "none" ? "0x6000" : `0x7f${implementationSlot}54`;
  const implementationAddress = `0x${"2".repeat(40)}`;
  let implementation = implementationAddress;
  let implementationCode = "0x6001";
  let signed = "";
  let status = "ACTIVITY_STATUS_CREATED";
  const activity = () => ({
    id: "controlled-activity",
    fingerprint: "controlled",
    organizationId: authority.organizationId,
    type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
    status,
    result: { signTransactionResult: { signedTransaction: signed } },
  });
  const transport: typeof fetch = async (url, init) => {
    if (String(url) === "https://testnet.perpl.xyz/api/v1/pub/context") {
      return Response.json(context);
    }
    if (String(url).startsWith("https://testnet.perpl.xyz/api/v1/trading/") && venueRead) {
      return venueRead(url, init);
    }
    assert.equal(String(url), "http://127.0.0.1:1");
    const request = JSON.parse(String(init?.body));
    const methods: Record<string, unknown> = {
      eth_chainId: "0x279f",
      eth_blockNumber: "0x10",
      eth_getStorageAt: `0x${"0".repeat(24)}${implementation.slice(2)}`,
      eth_getCode: request.params[0] === implementationAddress ? implementationCode : code,
      eth_getTransactionCount: nonce,
      eth_maxPriorityFeePerGas: "0x1",
      eth_getBlockByNumber: { baseFeePerGas: "0x1" },
      eth_estimateGas: "0x5208",
      eth_call: "0x" + accountIdentifier.toString(16).padStart(64, "0"),
    };
    if (request.method === "eth_sendRawTransaction") {
      sends++;
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: keccak256(request.params[0]),
      });
    }
    assert.ok(request.method in methods, `Unexpected controlled RPC ${request.method}`);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: methods[request.method] });
  };
  const driver = createPerplLiveDriver({
    policy: {
      version: 1,
      chainId: 10143,
      exchange: context.instances[0].address,
      exchangeCodeHash: keccak256(code as Hex),
      ...(proxy === "reviewed"
        ? {
            exchangeImplementation: {
              address: implementationAddress,
              codeHash: keccak256(implementationCode as Hex),
            },
          }
        : {}),
      enrollmentOrigin: "https://app.pickler.fun",
      rpcUrl: "http://127.0.0.1:1",
      maxCollateralMicros: "100000000",
      maxGas: 100000,
      maxFeePerGasWei,
      maxSlippageBps: 50,
    },
    encryptionKey: "11".repeat(32),
    transport,
    forwarder: {
      async forward() {
        forwards++;
        return activity();
      },
    },
    reader: {
      async getActivity() {
        reads++;
        return activity();
      },
    },
  });
  return {
    driver,
    context,
    useExistingAccount: (read: typeof fetch) => {
      accountIdentifier = 7n;
      venueRead = read;
    },
    authority,
    document,
    forwards: () => forwards,
    reads: () => reads,
    sends: () => sends,
    setNonce: () => {
      nonce = "0x1";
    },
    changeCode: () => {
      code = "0x6001";
    },
    changeImplementation: () => {
      implementation = `0x${"3".repeat(40)}`;
    },
    changeImplementationCode: () => {
      implementationCode = "0x6002";
    },
    complete: (value: string) => {
      signed = value;
      status = "ACTIVITY_STATUS_COMPLETED";
    },
  };
}
async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.driver.prepareSetup(f.authority, f.document, "100000000");
  const setup: PerplLiveSetup = {
    id: randomUUID(),
    key: randomUUID(),
    kind: result.kind,
    status: "awaiting_signature",
    amountMicros: "100000000",
    createdAt: Date.now(),
    activity: result.activity,
    privatePreparation: result.privatePreparation,
    activityId: null,
    txHash: null,
    error: null,
  };
  return setup;
}
test("onboarding prepares an exact bounded allowance without signing or sending", async () => {
  const f = await fixture();
  const setup = await prepared(f);
  const tx = parseTransaction(
    (setup.privatePreparation as { unsignedTransaction: Hex }).unsignedTransaction,
  );
  assert.equal(setup.kind, "approve");
  assert.equal(tx.chainId, 10143);
  const args = decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args!;
  assert.equal(String(args[0]).toLowerCase(), "0x1964c32f0be608e7d29302aff5e61268e72080cc");
  assert.equal(args[1], 100000000n);
  assert.ok(tx.gas! <= 100000n);
  assert.equal(f.forwards(), 0);
  assert.equal(f.sends(), 0);
  await assert.rejects(f.driver.prepareSetup(f.authority, f.document, "100000001"), {
    code: "PERPL_COLLATERAL_LIMIT",
  });
  f.changeCode();
  await assert.rejects(prepared(f), { code: "PERPL_BINDINGS_CHANGED" });
});
test("public deposit requirements do not sign, fund or change owner limits", async () => {
  const f = await fixture();
  const requirements = await f.driver.requirements!();

  assert.deepEqual(requirements, {
    minimumAccountMicros: "100000000",
    minimumDepositMicros: "10000000",
    maximumCollateralMicros: "100000000",
  });
  assert.equal(f.authority.perDayMicros, "100000000");
  assert.equal(f.forwards(), 0);
  assert.equal(f.sends(), 0);
});
test("a proxy requires reviewed implementation identity before any owner signing", async () => {
  const unreviewed = await fixture("100", "unreviewed");
  await assert.rejects(prepared(unreviewed), { code: "PERPL_BINDINGS_CHANGED" });
  assert.equal(unreviewed.forwards(), 0);
  assert.equal(unreviewed.sends(), 0);

  const reviewed = await fixture("100", "reviewed");
  assert.equal((await prepared(reviewed)).kind, "approve");

  reviewed.changeImplementation();
  await assert.rejects(prepared(reviewed), { code: "PERPL_BINDINGS_CHANGED" });
  assert.equal(reviewed.forwards(), 0);
  assert.equal(reviewed.sends(), 0);
});
test("an implementation bytecode change is refused even when its address stays the same", async () => {
  const reviewed = await fixture("100", "reviewed");
  await prepared(reviewed);

  reviewed.changeImplementationCode();
  await assert.rejects(prepared(reviewed), { code: "PERPL_BINDINGS_CHANGED" });
  assert.equal(reviewed.forwards(), 0);
  assert.equal(reviewed.sends(), 0);
});
test("a changed implementation blocks an HTTP order before a credential or request is used", async () => {
  const reviewed = await fixture("100", "reviewed");
  reviewed.changeImplementationCode();
  let guarded = false;

  await assert.rejects(
    reviewed.driver.submit(
      reviewed.document,
      { rq: 1, acc: 7, mkt: 16, t: 1, p: 0, s: 1, fl: 4, ms: 10, lv: 100, lb: 20 },
      async () => {
        guarded = true;
      },
    ),
    { code: "PERPL_BINDINGS_CHANGED" },
  );
  assert.equal(guarded, false);
  assert.equal(reviewed.forwards(), 0);
  assert.equal(reviewed.sends(), 0);
});
test("tampered activity and stale nonce are refused before forwarding a passkey signature", async () => {
  const f = await fixture();
  const setup = await prepared(f);
  const signed = {
    url: setup.activity!.url,
    body: setup.activity!.body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
  };
  await assert.rejects(
    f.driver.confirmSetup(
      f.authority,
      f.document,
      setup,
      { ...signed, body: "{}" },
      async () => {},
      async () => {},
    ),
    { name: "InvalidSignedActivityError" },
  );
  f.setNonce();
  await assert.rejects(
    f.driver.confirmSetup(
      f.authority,
      f.document,
      setup,
      signed,
      async () => {},
      async () => {},
    ),
    { name: "InvalidSignedActivityError" },
  );
  assert.equal(f.forwards(), 0);
  assert.equal(f.sends(), 0);
});
test("a pending Root activity is recovered by read, with signed bytes persisted before broadcast", async () => {
  const f = await fixture();
  const setup = await prepared(f);
  const request = {
    url: setup.activity!.url,
    body: setup.activity!.body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
  };
  const pending = await f.driver.confirmSetup(
    f.authority,
    f.document,
    setup,
    request,
    async () => {},
    async (change) => {
      Object.assign(setup, change);
    },
  );
  assert.equal(pending.status, "pending");
  const unsigned = parseTransaction(
    (setup.privatePreparation as { unsignedTransaction: Hex }).unsignedTransaction,
  );
  const raw = await owner.signTransaction({
    chainId: 10143,
    type: "eip1559",
    nonce: unsigned.nonce!,
    to: unsigned.to!,
    data: unsigned.data!,
    gas: unsigned.gas!,
    value: unsigned.value ?? 0n,
    maxFeePerGas: unsigned.maxFeePerGas!,
    maxPriorityFeePerGas: unsigned.maxPriorityFeePerGas!,
  });
  f.complete(raw);
  const result = await f.driver.reconcileSetup(
    f.authority,
    f.document,
    setup,
    async () => {
      assert.equal(setup.txHash, keccak256(raw));
      assert.equal(f.sends(), 0);
    },
    async (change) => {
      Object.assign(setup, change);
    },
  );
  assert.equal(result.txHash, keccak256(raw));
  assert.equal(result.confirmed, false);
  assert.equal(f.forwards(), 1);
  assert.equal(f.reads(), 1);
  assert.equal(f.sends(), 1);
});
test("a preparation cannot survive a stricter reviewed fee ceiling", async () => {
  const original = await fixture();
  const setup = await prepared(original);
  const restricted = await fixture("2");
  const request = {
    url: setup.activity!.url,
    body: setup.activity!.body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
  };
  await assert.rejects(
    restricted.driver.confirmSetup(
      original.authority,
      original.document,
      setup,
      request,
      async () => {},
      async () => {},
    ),
    { name: "InvalidSignedActivityError" },
  );
  assert.equal(restricted.forwards(), 0);
  assert.equal(restricted.sends(), 0);
});

// Public controlled Ed25519 seed; no production credential is used.
const importedSeed = "07".repeat(32);
const importedToken = "controlled-existing-token";
function existingVenue(
  f: Awaited<ReturnType<typeof fixture>>,
  wrongOwner = false,
  responses: Record<string, unknown> = {},
) {
  const key = createPrivateKey({
    key: Buffer.from("302e020100300506032b657004220420" + importedSeed, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(key);
  const paths: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).slice("https://testnet.perpl.xyz/api".length);
    paths.push(path);
    assert.equal(init?.method, "GET");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-API-Key"), importedToken);
    const canonical = [
      "10143",
      "GET",
      path,
      headers.get("X-API-Timestamp"),
      headers.get("X-API-Nonce"),
      createHash("sha256").update("").digest("hex"),
    ].join("\n");
    assert.equal(
      verify(
        null,
        Buffer.from(canonical),
        publicKey,
        Buffer.from(headers.get("X-API-Signature")!, "base64url"),
      ),
      true,
    );
    if (path === "/v1/trading/wallet") {
      return Response.json({
        addr: wrongOwner ? "0x" + "22".repeat(20) : f.authority.address,
        sn: 100,
        at: { t: Date.now() },
        as: [
          {
            in: f.context.instances[0].id,
            id: 7,
            fw: true,
            fr: false,
            lfr: 3,
            b: "100000000",
            lb: "0",
          },
        ],
      });
    }
    return Response.json(responses[path] ?? { d: [] });
  };
  return { fetcher, paths };
}
test("existing keys prove possession and wallet identity using GETs without enrollment or transactions", async () => {
  const f = await fixture("100", "reviewed");
  const venue = existingVenue(f);
  f.useExistingAccount(venue.fetcher);
  const connected = await f.driver.connectExistingKey!(
    f.authority,
    f.document,
    { apiKey: importedToken, privateKeyHex: importedSeed },
    Date.now() + 86400000,
  );
  assert.equal(connected.accountId, 7);
  assert.equal(connected.snapshot.lastRequestId, 3);
  assert.equal(connected.snapshot.forwarding, true);
  assert.equal(venue.paths.length, 5);
  assert.equal(f.sends(), 0);
  assert.equal(f.forwards(), 0);
  assert.equal(JSON.stringify(connected).includes(importedToken), false);
  assert.equal(JSON.stringify(connected).includes(importedSeed), false);
  assert.equal(f.document.encryptedToken, null);
});
test("an existing key for another wallet cannot be connected", async () => {
  const f = await fixture();
  const venue = existingVenue(f, true);
  f.useExistingAccount(venue.fetcher);
  await assert.rejects(
    f.driver.connectExistingKey!(
      f.authority,
      f.document,
      { apiKey: importedToken, privateKeyHex: importedSeed },
      Date.now() + 86400000,
    ),
    { code: "PERPL_EVIDENCE_MISMATCH" },
  );
  assert.equal(venue.paths.length, 1);
  assert.equal(f.document.encryptedToken, null);
});
test("existing key import rejects expired keys and unreviewed proxies before persistence", async () => {
  const refused = await fixture();
  refused.useExistingAccount(async () => new Response(null, { status: 401 }));
  await assert.rejects(
    refused.driver.connectExistingKey!(
      refused.authority,
      refused.document,
      { apiKey: importedToken, privateKeyHex: importedSeed },
      Date.now() + 86400000,
    ),
    { code: "PERPL_HTTP_401" },
  );
  const proxy = await fixture("100", "unreviewed");
  let calls = 0;
  proxy.useExistingAccount(async () => {
    calls++;
    throw new Error("Must not authenticate");
  });
  await assert.rejects(
    proxy.driver.connectExistingKey!(
      proxy.authority,
      proxy.document,
      { apiKey: importedToken, privateKeyHex: importedSeed },
      Date.now() + 86400000,
    ),
    { code: "PERPL_BINDINGS_CHANGED" },
  );
  assert.equal(calls, 0);
});

test("venue history normalizes bare transaction hashes before receipt verification", async () => {
  const f = await fixture();
  const rawHash = "AB".repeat(32);
  const order = {
    lv: 100,
    rq: 9,
    acc: 7,
    mkt: 16,
    oid: 11,
    t: 1,
    st: 4,
    os: 1,
    fs: 1,
    fp: 1000000,
    f: "345",
    at: { b: 100, txid: rawHash },
    c: {},
  };
  f.document.orders.push({
    id: "controlled-order",
    sessionId: "controlled-session",
    market: {
      id: 16,
      symbol: "BTC",
      mark: 1000000,
      priceDecimals: 1,
      sizeDecimals: 5,
      maxLeverage: 15,
      maxSlippageBps: 10,
      ttlBlocks: 20,
      takerFeeMicros: 345,
    },
    request: { rq: 9, acc: 7, mkt: 16, t: 1, p: 0, s: 1, fl: 4, ms: 10, lv: 100, lb: 120 },
    status: "accepted",
    createdAt: 1,
    submittedAt: 1,
    evidence: null,
    verifiedTxHashes: [],
    error: null,
  });
  const current = {
    pid: 42,
    rq: 0,
    acc: 7,
    mkt: 16,
    sd: 1,
    st: 1,
    sr: 0,
    s: 3,
    ep: 1000000,
    c: "3000000",
    lv: 100,
    fee: "345",
    at: {},
  };
  const opening = { ...current, rq: 9, s: 1, c: "1000000", at: { txid: rawHash } };
  const venue = existingVenue(f, false, {
    "/v1/trading/order-history?count=100": { d: [order] },
    "/v1/trading/positions": { d: [current] },
    "/v1/trading/position-history?count=100": { d: [opening] },
  });
  f.useExistingAccount(venue.fetcher);
  const connected = await f.driver.connectExistingKey!(
    f.authority,
    f.document,
    { apiKey: importedToken, privateKeyHex: importedSeed },
    Date.now() + 86400000,
  );
  assert.deepEqual(connected.snapshot.orders[0]!.txHashes, ["0x" + rawHash.toLowerCase()]);
  assert.equal(connected.snapshot.positions[0]!.requestId, 9);
  assert.equal(connected.snapshot.positions[0]!.size, 3);
  assert.equal(connected.snapshot.positions[0]!.collateralMicros, "3000000");
  assert.equal(f.sends(), 0);
  assert.equal(f.forwards(), 0);
});

test("malformed venue transaction hashes remain invalid account data, not bad credentials", async () => {
  const f = await fixture();
  const order = {
    lv: 100,
    rq: 9,
    acc: 7,
    mkt: 16,
    oid: 11,
    t: 1,
    st: 4,
    os: 1,
    fs: 1,
    fp: 1000000,
    f: "345",
    at: { txid: "untrusted-not-a-hash" },
  };
  const venue = existingVenue(f, false, { "/v1/trading/order-history?count=100": { d: [order] } });
  f.useExistingAccount(venue.fetcher);
  await assert.rejects(
    f.driver.connectExistingKey!(
      f.authority,
      f.document,
      { apiKey: importedToken, privateKeyHex: importedSeed },
      Date.now() + 86400000,
    ),
    { code: "PERPL_RESPONSE_INVALID" },
  );
  assert.equal(f.document.encryptedToken, null);
  assert.equal(f.sends(), 0);
});

test("an explicit key-wallet connection discovers and binds its authenticated wallet without funding", async () => {
  const f = await fixture();
  const venue = existingVenue(f, true);
  f.useExistingAccount(venue.fetcher);

  const connected = await f.driver.connectExistingKey!(
    f.authority,
    f.document,
    { apiKey: importedToken, privateKeyHex: importedSeed, useKeyWallet: true },
    Date.now() + 86400000,
  );

  assert.equal(connected.address, "0x" + "22".repeat(20));
  assert.equal(connected.accountId, 7);
  assert.equal(venue.paths.length, 6);
  assert.equal(f.document.address, f.authority.address);
  assert.equal(f.sends(), 0);
  assert.equal(f.forwards(), 0);
  assert.equal(JSON.stringify(connected).includes(importedSeed), false);
});

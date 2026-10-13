import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
async function fixture(maxFeePerGasWei = "100") {
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
  let forwards = 0;
  let reads = 0;
  let sends = 0;
  let nonce = "0x0";
  let code = "0x6000";
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
    assert.equal(String(url), "http://127.0.0.1:1");
    const request = JSON.parse(String(init?.body));
    const methods: Record<string, unknown> = {
      eth_chainId: "0x279f",
      eth_getCode: code,
      eth_getTransactionCount: nonce,
      eth_maxPriorityFeePerGas: "0x1",
      eth_getBlockByNumber: { baseFeePerGas: "0x1" },
      eth_estimateGas: "0x5208",
      eth_call: "0x" + "0".repeat(64),
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

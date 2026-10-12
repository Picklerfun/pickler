import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AUSD_ADDRESS } from "../src/config/chain";
import {
  buildAuthorization, checkTerms, decodeSettlement, encodePayment, nonceFor, parsePaymentRequired,
  randomSalt, shares, typedData,
} from "../src/advice/x402";
import type { Terms } from "../src/advice/types";

// Anvil's first key: a test key, never funded anywhere real.
const BUYER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const SPLITTER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PAYEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SALT = "0x00000000000000000000000000000000000000000000000000000000000000ab";
const NOW = 1_760_000_000_000;

const accepts = {
  scheme: "exact",
  network: "monad-testnet",
  maxAmountRequired: "1500000",
  resource: "https://pickler.fun/api/v1/agent-advice/agents/6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b/recommendations",
  description: "Fresh 24-hour BTC analysis by @mira",
  mimeType: "application/json",
  payTo: SPLITTER,
  maxTimeoutSeconds: 300,
  asset: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  extra: {
    name: "Agora Dollar", version: "1", chainId: 10143, primaryType: "ReceiveWithAuthorization", payee: PAYEE,
    creatorBps: 6500, protocolBps: 3500, nonceDerivation: "keccak256(abi.encode(payee,salt))",
  },
};
const required = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  x402Version: 1, error: "X-PAYMENT header is required", ...top,
  accepts: [{ ...accepts, ...over, extra: { ...accepts.extra, ...extra } }],
});
const termsOf = (body: unknown): Terms => {
  const { terms } = parsePaymentRequired(body);
  if (!terms) throw new Error("terms did not parse");
  return terms;
};

describe("parsePaymentRequired", () => {
  test("reads the 402 the API sends before any payment", () => {
    const { terms, error } = parsePaymentRequired(required());

    expect(error).toBeNull();
    expect(terms).toMatchObject({ payTo: SPLITTER, payee: PAYEE, value: 1_500_000n, maxTimeoutSeconds: 300, resource: accepts.resource });
  });

  test("carries the refusal of a payment the API turned down", () => {
    expect(parsePaymentRequired(required({}, {}, { error: "settlement_failed" })).error).toBe("settlement_failed");
    expect(parsePaymentRequired(required({}, {}, { error: "invalid_payment" })).error).toBe("invalid_payment");
  });

  test("reads an unknown error as a refusal, never as a fresh 402", () => {
    expect(parsePaymentRequired(required({}, {}, { error: "something_new" })).error).toBe("invalid_payment");
  });

  test.each([
    ["not an object", "402"],
    ["no accepts", { x402Version: 1, error: "invalid_payment" }],
    ["two sets of terms", { ...required(), accepts: [accepts, accepts] }],
    ["an amount that is not an integer", required({ maxAmountRequired: "1.5" })],
    ["no extra", { x402Version: 1, error: "invalid_payment", accepts: [{ ...accepts, extra: undefined }] }],
    ["no payee", required({}, { payee: undefined })],
  ])("gives no terms for %s", (_, body) => {
    expect(parsePaymentRequired(body).terms).toBeNull();
  });
});

describe("checkTerms", () => {
  test("a good 402 for the price the list showed is ok", () => {
    expect(checkTerms(termsOf(required()), 1_500_000n)).toBe("ok");
  });

  test("a different amount is price_changed", () => {
    expect(checkTerms(termsOf(required({ maxAmountRequired: "2000000" })), 1_500_000n)).toBe("price_changed");
    expect(checkTerms(termsOf(required({ maxAmountRequired: "1000000" })), 1_500_000n)).toBe("price_changed");
  });

  test.each([
    ["another asset", required({ asset: "0x0000000000000000000000000000000000000001" })],
    ["another chain", required({}, { chainId: 1 })],
    ["another primaryType", required({}, { primaryType: "TransferWithAuthorization" })],
    ["other creatorBps", required({}, { creatorBps: 5000 })],
    ["other protocolBps", required({}, { protocolBps: 5000 })],
    ["another network", required({ network: "base-sepolia" })],
    ["another scheme", required({ scheme: "upto" })],
    ["another x402Version", required({}, {}, { x402Version: 2 })],
    ["maxTimeoutSeconds 301", required({ maxTimeoutSeconds: 301 })],
    ["another token name", required({}, { name: "USD Coin" })],
    ["another domain version", required({}, { version: "2" })],
    ["another nonce derivation", required({}, { nonceDerivation: "keccak256(salt)" })],
    ["a payTo that is not an address", required({ payTo: "0x1234" })],
    ["a payee that is not an address", required({}, { payee: "agent.eth" })],
    ["the payee equal to payTo", required({}, { payee: SPLITTER.toLowerCase() })],
  ])("%s is untrusted", (_, body) => {
    expect(checkTerms(termsOf(body), 1_500_000n)).toBe("untrusted");
  });

  test("untrusted wins over a changed price", () => {
    expect(checkTerms(termsOf(required({ maxAmountRequired: "2000000", asset: "0x0000000000000000000000000000000000000001" })), 1_500_000n)).toBe("untrusted");
  });
});

describe("signing helpers", () => {
  test("nonceFor matches the contract's vector", () => {
    expect(nonceFor("0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000000000000000000000000001"))
      .toBe("0xb34209a263f6c38fe55f099e9e70f9d67e93982480ff3234a5e0108028ad164d");
  });

  test("buildAuthorization pays the splitter the full price, valid for 240 s, nonce bound to the payee", () => {
    const a = buildAuthorization({ from: BUYER.address, terms: termsOf(required()), now: NOW, salt: SALT });

    expect(a).toEqual({
      from: BUYER.address, to: SPLITTER, value: 1_500_000n, validAfter: 0n, validBefore: BigInt(NOW / 1000 + 240),
      nonce: nonceFor(PAYEE, SALT), salt: SALT,
    });
  });

  test("typedData signed by the buyer recovers the buyer; changing `to` breaks it", async () => {
    const a = buildAuthorization({ from: BUYER.address, terms: termsOf(required()), now: NOW, salt: SALT });
    const data = typedData(a);
    expect(data.domain).toEqual({ name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD_ADDRESS });
    expect(data.primaryType).toBe("ReceiveWithAuthorization");

    const signature = await BUYER.signTypedData(data);

    expect(await recoverTypedDataAddress({ ...data, signature })).toBe(BUYER.address);
    const moved = { ...data, message: { ...data.message, to: PAYEE as `0x${string}` } };
    expect(await recoverTypedDataAddress({ ...moved, signature })).not.toBe(BUYER.address);
  });

  test("encodePayment gives the X-PAYMENT the server decodes, with exactly its field names", async () => {
    const a = buildAuthorization({ from: BUYER.address, terms: termsOf(required()), now: NOW, salt: SALT });
    const signature = await BUYER.signTypedData(typedData(a));

    const header = encodePayment(a, signature);
    const decoded = JSON.parse(atob(header));

    expect(Object.keys(decoded).sort()).toEqual(["network", "payload", "scheme", "x402Version"]);
    expect(Object.keys(decoded.payload).sort()).toEqual(["authorization", "signature"]);
    expect(Object.keys(decoded.payload.authorization).sort()).toEqual(["from", "nonce", "salt", "to", "validAfter", "validBefore", "value"]);
    expect(decoded).toEqual({
      x402Version: 1, scheme: "exact", network: "monad-testnet",
      payload: {
        signature: signature.toLowerCase(),
        authorization: {
          from: BUYER.address.toLowerCase(), to: SPLITTER.toLowerCase(), value: "1500000", validAfter: "0",
          validBefore: String(NOW / 1000 + 240), nonce: nonceFor(PAYEE, SALT), salt: SALT,
        },
      },
    });
    // The patterns core's decodePaymentHeader applies (packages/core/src/features/advice/x402.ts).
    const auth = decoded.payload.authorization;
    expect(decoded.payload.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    for (const k of ["from", "to"]) expect(auth[k]).toMatch(/^0x[0-9a-f]{40}$/);
    for (const k of ["value", "validAfter", "validBefore"]) expect(auth[k]).toMatch(/^\d{1,78}$/);
    for (const k of ["nonce", "salt"]) expect(auth[k]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("randomSalt is 32 lowercase bytes and differs each time", () => {
    const a = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(randomSalt()).not.toBe(a);
  });

  test("shares gives the creator the floor of 65% and Pickler the rest", () => {
    expect(shares(1_500_000n)).toEqual({ creator: 975_000n, protocol: 525_000n });
    expect(shares(100_001n)).toEqual({ creator: 65_000n, protocol: 35_001n });
  });
});

describe("decodeSettlement", () => {
  const tx = "0x" + "ab".repeat(32);
  const encode = (o: unknown) => btoa(JSON.stringify(o));

  test("reads the header the API's encodeSettlement writes", () => {
    const header = encode({ success: true, transaction: tx, network: "monad-testnet", payer: BUYER.address });
    expect(decodeSettlement(header)).toEqual({ transaction: tx, payer: BUYER.address });
  });

  test.each([
    ["no header", null],
    ["not base64", "%%%"],
    ["not JSON", btoa("hello")],
    ["success false", encode({ success: false, transaction: tx, network: "monad-testnet", payer: BUYER.address })],
    ["another network", encode({ success: true, transaction: tx, network: "base", payer: BUYER.address })],
    ["a short hash", encode({ success: true, transaction: "0xabc", network: "monad-testnet", payer: BUYER.address })],
    ["a payer that is not an address", encode({ success: true, transaction: tx, network: "monad-testnet", payer: "me" })],
  ])("is null for %s", (_, header) => {
    expect(decodeSettlement(header)).toBeNull();
  });
});

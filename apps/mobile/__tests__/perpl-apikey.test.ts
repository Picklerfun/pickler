import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import { hashTypedData, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import payload from "./fixtures/perpl/apikey-payload.json";
import {
  describeEnrollError, enrollTradingKey, generateTradingKey, normalizeTypedData, signWsSignin, wsSigninCanonical,
} from "../src/perpl/apiKey";

const utf8 = (s: string) => new TextEncoder().encode(s);

test("wsSigninCanonical has exactly four newline-joined fields", () => {
  expect(wsSigninCanonical(10143, "1789606875716", "l2oDHV6XX4xFxKC0aMAQ8A")).toBe("10143\ntrading-ws-signin\n1789606875716\nl2oDHV6XX4xFxKC0aMAQ8A");
});

test("signWsSignin signs the canonical string with a verifiable Ed25519 key, base64url without padding", () => {
  const { privateKey, publicKeyHex } = generateTradingKey();
  expect(publicKeyHex).toMatch(/^0x[0-9a-f]{64}$/);
  const nonceBytes = new Uint8Array(16).fill(1);
  const { timestamp, nonce, signature } = signWsSignin(privateKey, 10143, 1789606875716, nonceBytes);
  expect(timestamp).toBe("1789606875716");
  expect(nonce).toBe(base64urlnopad.encode(nonceBytes));
  expect(signature).not.toMatch(/=/);
  const ok = ed25519.verify(base64urlnopad.decode(signature), utf8(wsSigninCanonical(10143, timestamp, nonce)), hexToBytes(publicKeyHex));
  expect(ok).toBe(true);
  // contra el defecto: otra cadena canónica no verifica
  expect(ed25519.verify(base64urlnopad.decode(signature), utf8(wsSigninCanonical(143, timestamp, nonce)), hexToBytes(publicKeyHex))).toBe(false);
});

test("normalizeTypedData drops EIP712Domain and turns chainId/time hex into bigint", () => {
  const td = normalizeTypedData(payload.typed_data);
  expect(td.primaryType).toBe("PerplRegisterApiKey");
  expect(Object.keys(td.types)).toEqual(["PerplRegisterApiKey"]);
  expect(td.domain).toMatchObject({ name: "perpl.xyz", version: "1", chainId: 10143n });
  expect((td.message as Record<string, unknown>).time).toBe(0x1a0ace2d7c9n);
  expect((td.message as Record<string, unknown>).label).toBe("Pickler iOS");
  expect(typeof hashTypedData(td)).toBe("string");
});

test("normalizeTypedData rejects a payload without types or message", () => {
  expect(() => normalizeTypedData({ primaryType: "X" })).toThrow();
  expect(() => normalizeTypedData(null)).toThrow();
});

test("enrollTradingKey posts payload then enroll (no Origin header) and returns the api_key", async () => {
  const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000007");
  const { privateKey, publicKeyHex } = generateTradingKey();
  const calls: { url: string; init: RequestInit }[] = [];
  (globalThis as { fetch: typeof fetch }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/api-key/payload")) return new Response(JSON.stringify(payload), { status: 200 });
    return new Response(JSON.stringify({ api_key: { api_key: "key-123" } }), { status: 200 });
  }) as unknown as typeof fetch;

  const key = await enrollTradingKey({ address: account.address, account }, publicKeyHex, privateKey, "https://x.test/api");
  expect(key).toBe("key-123");
  expect(calls[0].url).toBe("https://x.test/api/v1/api-key/payload");
  const req = JSON.parse(calls[0].init.body as string);
  expect(req).toEqual({ chain_id: 10143, address: account.address, public_key: publicKeyHex, scope_mask: 3, label: "Pickler iOS" });
  expect(Object.keys(calls[0].init.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain("origin");
  const enroll = JSON.parse(calls[1].init.body as string);
  expect(enroll.mac).toBe(payload.mac);
  expect(enroll.typed_data).toEqual(payload.typed_data);
  // firma de la wallet y prueba de posesión Ed25519 sobre el digest EIP-712
  const digest = hashTypedData(normalizeTypedData(payload.typed_data));
  expect(await account.signTypedData(normalizeTypedData(payload.typed_data))).toBe(enroll.signature);
  expect(ed25519.verify(hexToBytes(enroll.pop_signature), hexToBytes(digest), hexToBytes(publicKeyHex))).toBe(true);
});

test.each([
  [404, "Create the trading account first."],
  [409, "This trading key already exists. Try again."],
  [423, "Too many trading keys. Revoke one at testnet.perpl.xyz/apikeys."],
  [422, "Perpl rejected the enrolment (422)."],
])("describeEnrollError(%i)", (status, text) => {
  expect(describeEnrollError(status)).toBe(text);
});

test("enrollTradingKey throws the described error on a non-200 enroll", async () => {
  const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000007");
  const { privateKey, publicKeyHex } = generateTradingKey();
  (globalThis as { fetch: typeof fetch }).fetch = jest.fn(async (url: string) =>
    url.endsWith("/payload") ? new Response(JSON.stringify(payload), { status: 200 }) : new Response("{}", { status: 404 }),
  ) as unknown as typeof fetch;
  await expect(enrollTradingKey({ address: account.address, account }, publicKeyHex, privateKey, "https://x.test/api")).rejects.toThrow("Create the trading account first.");
});

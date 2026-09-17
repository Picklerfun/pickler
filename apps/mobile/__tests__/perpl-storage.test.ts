import { base64urlnopad } from "@scure/base";
import { parseTradingKey, serializeTradingKey } from "../src/storage/perpl";

const priv = new Uint8Array(32).fill(9);
const key = {
  address: "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f" as const,
  accountId: 619n,
  apiKey: "bsFg6n-abc_123",
  privateKey: priv,
};

test("round-trips a trading key (bigint as string, private key as base64url)", () => {
  const raw = serializeTradingKey(key);
  const parsed = JSON.parse(raw);
  expect(parsed.accountId).toBe("619");
  expect(parsed.privateKey).toBe(base64urlnopad.encode(priv));
  expect(parseTradingKey(raw)).toEqual(key);
});

test.each([
  ["not json", "{"],
  ["bad address", JSON.stringify({ address: "0x12", accountId: "619", apiKey: "k", privateKey: base64urlnopad.encode(priv) })],
  ["non-numeric account", JSON.stringify({ address: key.address, accountId: "x", apiKey: "k", privateKey: base64urlnopad.encode(priv) })],
  ["zero account", JSON.stringify({ address: key.address, accountId: "0", apiKey: "k", privateKey: base64urlnopad.encode(priv) })],
  ["empty api key", JSON.stringify({ address: key.address, accountId: "619", apiKey: "", privateKey: base64urlnopad.encode(priv) })],
  ["short private key", JSON.stringify({ address: key.address, accountId: "619", apiKey: "k", privateKey: base64urlnopad.encode(new Uint8Array(31)) })],
  ["missing fields", JSON.stringify({})],
])("rejects %s", (_, raw) => {
  expect(parseTradingKey(raw)).toBeUndefined();
});

import { parseStoredAccount } from "../src/storage/storage";

test("parses a valid stored account", () => {
  const raw = JSON.stringify({
    address: "0x1111111111111111111111111111111111111111",
    credentialId: "abc-DEF_123",
  });
  expect(parseStoredAccount(raw)).toEqual({
    address: "0x1111111111111111111111111111111111111111",
    credentialId: "abc-DEF_123",
  });
});

test.each([
  ["not json", "{"],
  ["bad address", JSON.stringify({ address: "0x12", credentialId: "a" })],
  ["bad credential chars", JSON.stringify({ address: "0x1111111111111111111111111111111111111111", credentialId: "a b" })],
  ["missing fields", JSON.stringify({})],
])("rejects %s", (_, raw) => {
  expect(parseStoredAccount(raw)).toBeUndefined();
});

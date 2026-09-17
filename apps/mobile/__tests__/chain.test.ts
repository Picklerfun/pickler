import {
  AUSD_ADDRESS,
  AUSD_DECIMALS,
  AUSD_FAUCET_ADDRESS,
  CHAIN,
  EXPLORER_TX_URL,
  ERC20_ABI,
  ausdToNumber,
  formatAusd,
  formatMon,
  parseAusd,
  shortHash,
} from "../src/config/chain";

test("chain is Monad Testnet", () => {
  expect(CHAIN.id).toBe(10143);
  expect(CHAIN.rpcUrls.default.http[0]).toBe("https://testnet-rpc.monad.xyz");
});

test("AUSD testnet address and decimals match Agora docs", () => {
  expect(AUSD_ADDRESS).toBe("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
  expect(AUSD_DECIMALS).toBe(6);
  expect(AUSD_FAUCET_ADDRESS).toBe("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
});

test("formatAusd shows two decimals", () => {
  expect(formatAusd(0n)).toBe("0.00");
  expect(formatAusd(1_500_000n)).toBe("1.50");
  expect(formatAusd(123_456_789n)).toBe("123.45");
});

test("formatMon shows four decimals", () => {
  expect(formatMon(0n)).toBe("0.0000");
  expect(formatMon(1_234_500_000_000_000_000n)).toBe("1.2345");
});

test("explorer url points to a tx", () => {
  expect(EXPLORER_TX_URL("0xabc")).toBe("https://testnet.monadexplorer.com/tx/0xabc");
});

test("ausdToNumber turns 6-decimal units into a plain number", () => {
  expect(ausdToNumber(1_240_000_000n)).toBe(1240);
  expect(ausdToNumber(318_400_000n)).toBe(318.4);
  expect(ausdToNumber(0n)).toBe(0);
});

test("parseAusd turns decimal text into 6-decimal units", () => {
  expect(parseAusd("12")).toBe(12_000_000n);
  expect(parseAusd("12.5")).toBe(12_500_000n);
  expect(parseAusd("0.000001")).toBe(1n);
  expect(parseAusd(" 1,5 ")).toBe(1_500_000n);
});

test("parseAusd rejects empty, negative, too precise and non-numeric text", () => {
  expect(parseAusd("")).toBeUndefined();
  expect(parseAusd("-1")).toBeUndefined();
  expect(parseAusd("1.1234567")).toBeUndefined();
  expect(parseAusd("abc")).toBeUndefined();
  expect(parseAusd("1e3")).toBeUndefined();
  expect(parseAusd(".")).toBeUndefined();
});

test("shortHash keeps the first six and last four characters", () => {
  expect(shortHash("0x7ef471355eeca24d0ea11638b40140e57c0a42d2955652d0a1bd45b4dd962ef1")).toBe("0x7ef4…2ef1");
});

test("ERC20 ABI has transfer", () => {
  expect(ERC20_ABI.some((f) => f.type === "function" && f.name === "transfer")).toBe(true);
});

test("ERC20 ABI has approve and allowance", () => {
  const names = ERC20_ABI.filter((f) => f.type === "function").map((f) => f.name);
  expect(names).toEqual(expect.arrayContaining(["balanceOf", "transfer", "approve", "allowance"]));
});

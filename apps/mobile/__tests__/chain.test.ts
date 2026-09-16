import {
  AUSD_ADDRESS,
  AUSD_DECIMALS,
  AUSD_FAUCET_ADDRESS,
  CHAIN,
  EXPLORER_TX_URL,
  formatAusd,
  formatMon,
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

import { toFunctionSelector } from "viem";
import {
  EXCHANGE_ABI,
  EXCHANGE_ADDRESS,
  LEVERAGES,
  PERPL_CHAIN_ID,
  PERPL_REST,
  PERPL_WS,
  PING_MS,
  TRADING_KEY_LABEL,
} from "../src/perpl/config";

test("Perpl testnet constants match the verified context", () => {
  expect(PERPL_CHAIN_ID).toBe(10143);
  expect(PERPL_REST).toBe("https://testnet.perpl.xyz/api");
  expect(PERPL_WS).toBe("wss://testnet.perpl.xyz/ws/v1/trading");
  expect(EXCHANGE_ADDRESS).toBe("0x1964c32f0be608e7d29302aff5e61268e72080cc");
  expect(TRADING_KEY_LABEL).toBe("Pickler iOS");
  expect(PING_MS).toBe(3000);
  expect(LEVERAGES).toEqual([1, 2, 3, 5]);
});

// Selectores confirmados en la implementación 0xbcbd37…adbb (docs/investigacion/perpl.md).
test.each([
  ["createAccount", "0xcab13915"],
  ["allowOrderForwarding", "0x7962f910"],
  ["getAccountByAddr", "0x12e8eb2c"],
  ["depositCollateral", "0xbad4a01f"],
  ["withdrawCollateral", "0x6112fe2e"],
])("exchange ABI %s has the on-chain selector", (name, selector) => {
  const fn = EXCHANGE_ABI.find((f) => f.type === "function" && f.name === name);
  expect(fn).toBeDefined();
  expect(toFunctionSelector(fn!)).toBe(selector);
});

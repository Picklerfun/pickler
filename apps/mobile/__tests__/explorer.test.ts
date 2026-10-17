import type { Address } from "viem";
import { AUSD_FAUCET_ADDRESS } from "../src/config/chain";
import { parseTokenTxResponse, pendingMovement, toMovements, type Transfer } from "../src/wallet/explorer";

const ME = "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f" as const;
const OTHER = "0x51289183f21d0cfb0d698ca13c332c438749eb09" as const;

// Respuesta real de api.etherscan.io/v2 (chainid 10143, tokentx) del 2026-09-16, recortada a los campos que se usan.
const REAL = {
  status: "1",
  message: "OK",
  result: [
    { blockNumber: "62852614", timeStamp: "1789507960", hash: "0x7ef471355eeca24d0ea11638b40140e57c0a42d2955652d0a1bd45b4dd962ef1", from: "0x29458c602e3db4fc3b54ec2bbee26dbe64c7779f", to: OTHER, value: "5000000", tokenDecimal: "6" },
    { blockNumber: "62852451", timeStamp: "1789507911", hash: "0x74ddd9e604c8dc73298e5d91428b836b95418cd928969c35bce7c053f9eb9dc6", from: AUSD_FAUCET_ADDRESS.toLowerCase(), to: "0x29458c602e3db4fc3b54ec2bbee26dbe64c7779f", value: "10000000000", tokenDecimal: "6" },
  ],
};

test("parseTokenTxResponse turns the explorer payload into Transfers", () => {
  const t = parseTokenTxResponse(REAL);
  expect(t).toHaveLength(2);
  expect(t[0]).toEqual({ hash: REAL.result[0].hash, block: 62852614n, timestamp: 1789507960, from: REAL.result[0].from, to: OTHER, value: 5_000_000n });
});

test("parseTokenTxResponse treats 'No transactions found' as empty and other errors as failures", () => {
  expect(parseTokenTxResponse({ status: "0", message: "No transactions found", result: [] })).toEqual([]);
  expect(() => parseTokenTxResponse({ status: "0", message: "NOTOK", result: "Missing/Invalid API Key" })).toThrow(/Missing\/Invalid API Key/);
  expect(() => parseTokenTxResponse({ nonsense: true })).toThrow();
});

test("toMovements classifies faucet, deposit and withdrawal, case-insensitively, newest first", () => {
  const transfers: Transfer[] = [
    { hash: "0x1", block: 10n, timestamp: 100, from: OTHER, to: ME.toLowerCase() as Address, value: 7n },
    { hash: "0x3", block: 30n, timestamp: 300, from: ME.toLowerCase() as Address, to: OTHER, value: 5n },
    { hash: "0x2", block: 20n, timestamp: 200, from: AUSD_FAUCET_ADDRESS.toLowerCase() as Address, to: ME, value: 9n },
  ];
  const m = toMovements(transfers, ME);
  expect(m.map((x) => [x.hash, x.kind, x.sign, x.amount, x.status])).toEqual([
    ["0x3", "Withdrawal", "-", 5n, "Complete"],
    ["0x2", "Faucet", "+", 9n, "Complete"],
    ["0x1", "Deposit", "+", 7n, "Complete"],
  ]);
});

test("pendingMovement is a Confirming row with the right sign", () => {
  const w = pendingMovement("Withdrawal", 3n, "0xab");
  expect(w.status).toBe("Confirming");
  expect(w.sign).toBe("-");
  expect(pendingMovement("Faucet", 3n, "0xcd").sign).toBe("+");
});

describe("toMovements with the advice splitter", () => {
  const SPLITTER = "0x570A000000000000000000000000000000004d2a" as Address;
  const pay = (to: Address): Transfer[] => [{ hash: "0x9", block: 9n, timestamp: 90, from: ME, to, value: 150n }];

  test("a transfer from the wallet to the splitter is an Agent analysis, case-insensitively", () => {
    expect(toMovements(pay(SPLITTER), ME, SPLITTER).map((x) => [x.kind, x.sign])).toEqual([["Agent analysis", "-"]]);
    expect(toMovements(pay(SPLITTER.toUpperCase().replace("0X", "0x") as Address), ME, SPLITTER)[0]?.kind).toBe("Agent analysis");
    expect(toMovements(pay(SPLITTER), ME, SPLITTER.toLowerCase() as Address)[0]?.kind).toBe("Agent analysis");
  });

  test("another outgoing address stays a Withdrawal", () => {
    expect(toMovements(pay(OTHER), ME, SPLITTER)[0]?.kind).toBe("Withdrawal");
  });

  test("with no splitter configured nothing changes", () => {
    expect(toMovements(pay(SPLITTER), ME, null)[0]?.kind).toBe("Withdrawal");
    expect(toMovements(pay(SPLITTER), ME)[0]?.kind).toBe("Withdrawal");
  });

  test("a pending Agent analysis is an outgoing row", () => {
    expect(pendingMovement("Agent analysis", 3n, "0xef").sign).toBe("-");
  });
});

import { validateFunds } from "../src/perpl/funds";

test("add: minimum deposit and wallet balance", () => {
  expect(validateFunds("add", "5", 50_000_000n, 0n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "Minimum deposit is 10.00 AUSD." });
  expect(validateFunds("add", "60", 50_000_000n, 0n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "That is more than the 50.00 AUSD in your wallet." });
  expect(validateFunds("add", "10", 50_000_000n, 0n, 10_000_000n, 10_000n)).toEqual({ ok: true, amount: 10_000_000n });
});

test("withdraw: minimum and free balance only", () => {
  expect(validateFunds("withdraw", "0.001", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "Minimum withdrawal is 0.01 AUSD." });
  expect(validateFunds("withdraw", "5.01", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "That is more than the 5.00 AUSD free in trading." });
  expect(validateFunds("withdraw", "5", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: true, amount: 5_000_000n });
  expect(validateFunds("withdraw", "", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "Enter an amount above zero." });
});

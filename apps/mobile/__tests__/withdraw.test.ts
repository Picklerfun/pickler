import { validateWithdraw } from "../src/wallet/withdraw";

const to = "0x51289183f21d0cfb0d698ca13c332c438749eb09";

test("a valid address and an amount within balance are ok", () => {
  expect(validateWithdraw({ to, amount: "1.5", ausd: 2_000_000n })).toEqual({ ok: true, to, amount: 1_500_000n });
});

test("an invalid address is rejected", () => {
  expect(validateWithdraw({ to: "0x123", amount: "1", ausd: 2_000_000n })).toEqual({ ok: false, error: "That is not a valid Monad address." });
  expect(validateWithdraw({ to: "", amount: "1", ausd: 2_000_000n })).toEqual({ ok: false, error: "Paste the destination address." });
});

test("zero, unparsable and over-balance amounts are rejected", () => {
  expect(validateWithdraw({ to, amount: "0", ausd: 2_000_000n })).toEqual({ ok: false, error: "Enter an amount above zero." });
  expect(validateWithdraw({ to, amount: "abc", ausd: 2_000_000n })).toEqual({ ok: false, error: "Enter an amount above zero." });
  expect(validateWithdraw({ to, amount: "", ausd: 2_000_000n })).toEqual({ ok: false, error: "Enter an amount above zero." });
  expect(validateWithdraw({ to, amount: "2.000001", ausd: 2_000_000n })).toEqual({ ok: false, error: "That is more than the 2.00 AUSD available." });
});

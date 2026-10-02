import { portfolioTotals } from "../src/perpl/portfolio";

const A = 1_000_000n; // 1 AUSD (6 decimales)

test("total = free + locked in orders + position collateral + unrealised PnL (D7)", () => {
  expect(portfolioTotals({ b: 100n * A, lb: 10n * A, locked: 20n * A, upnl: -2n * A }))
    .toEqual({ available: 90n * A, inOrders: 10n * A, positions: 18n * A, total: 118n * A });
});

test("no PnL yet counts as zero; lb above b never goes negative", () => {
  expect(portfolioTotals({ b: 5n * A, lb: 0n, locked: 0n, upnl: null })).toEqual({ available: 5n * A, inOrders: 0n, positions: 0n, total: 5n * A });
  expect(portfolioTotals({ b: 5n * A, lb: 8n * A, locked: 0n, upnl: null })).toEqual({ available: 0n, inOrders: 5n * A, positions: 0n, total: 5n * A });
});

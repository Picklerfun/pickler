import contextJson from "./fixtures/perpl/context.json";
import frames from "./fixtures/perpl/ws-frames.json";
import { parseContext } from "../src/perpl/context";
import {
  change24h, closeIntent, describeOrderStatus, formatPrice, formatPnl, formatSize, leveragesFor, liquidationPrice,
  lockedCollateral, notionalAusd, openIntent, orderFrame, positionPnl, sizeFromAusd, takerFee, unrealisedPnl,
} from "../src/perpl/orders";

const ctx = parseContext(contextJson);
const MON = ctx.markets.find((m) => m.id === 64)!;
const BTC = ctx.markets.find((m) => m.id === 16)!;

test("sizeFromAusd: 11.1 AUSD at 1x with MON at 0.02220 is 500 MON", () => {
  expect(sizeFromAusd(11_100_000n, 1, 2220, 5, 0)).toBe(500);
  expect(sizeFromAusd(11_100_000n, 3, 2220, 5, 0)).toBe(1500);
  // BTC: pd 1, sd 5; 100 AUSD at $76,255.5 → 0.00131 BTC = 131 units (floor)
  expect(sizeFromAusd(100_000_000n, 1, 762555, 1, 5)).toBe(131);
  expect(sizeFromAusd(0n, 1, 2220, 5, 0)).toBe(0);
});

test("notionalAusd inverts sizeFromAusd", () => {
  expect(notionalAusd(500, 2220, 5, 0)).toBe(11_100_000n);
  expect(notionalAusd(100, 2221, 5, 0)).toBe(2_221_000n);
});

test("takerFee rounds up like the exchange (fixture: 2.221 AUSD × 345 micros → 767)", () => {
  expect(takerFee(2_221_000n, 345)).toBe(767n);
  expect(takerFee(11_100_000n, 345)).toBe(3830n);
  expect(takerFee(0n, 345)).toBe(0n);
});

test("liquidationPrice: maintenance is mm/10000 of the initial margin (ruling 2)", () => {
  // MON: maxLeverage 3, mm 500 → 1.67 % of notional
  expect(liquidationPrice(2221, 1, "long", 500, 3)).toBe(37);        // ≈ 0.0167 × entry
  expect(liquidationPrice(2221, 3, "long", 500, 3)).toBe(1518);      // entry × (1 − 1/3 + 0.0167)
  expect(liquidationPrice(2221, 3, "short", 500, 3)).toBe(2924);     // entry × (1 + 1/3 − 0.0167)
  expect(liquidationPrice(762555, 5, "long", 2500, 15)).toBe(622753); // BTC 5x: × (0.8 + 0.0167)
});

test("positionPnl matches the realised delta of the real close (−4000)", () => {
  const opened = frames.positionOpened.d[0];
  expect(positionPnl({ mkt: 64, sd: 1, s: opened.s, ep: opened.ep, lv: opened.lv }, 2217, 5, 0)).toBe(-4000n);
  expect(positionPnl({ mkt: 64, sd: 2, s: 100, ep: 2221, lv: 100 }, 2217, 5, 0)).toBe(4000n);
  expect(positionPnl({ mkt: 64, sd: 1, s: 100, ep: 2221, lv: 100 }, 2221, 5, 0)).toBe(0n);
});

test("change24h is a signed fraction", () => {
  expect(change24h(2221, 2164)).toBeCloseTo(0.02634, 4);
  expect(change24h(2000, 2500)).toBeCloseTo(-0.2, 6);
  expect(change24h(2000, 0)).toBe(0);
});

test("leveragesFor caps the selector at the market maximum (MON 3x, BTC 15x)", () => {
  expect(leveragesFor(MON)).toEqual([1, 2, 3]);
  expect(leveragesFor(BTC)).toEqual([1, 2, 3, 5]);
  expect(leveragesFor({ maxLeverage: 1 })).toEqual([1]);
});

test("orderFrame: rq = lfr + 1, lb = head + ttl, market IOC, leverage in hundredths", () => {
  const intent = openIntent(MON, 619, "long", 100, 1);
  const frame = orderFrame(intent, { sn: 3, rq: 6, head: 63177640 });
  expect(frame).toEqual(frames.sentOpen);           // el frame real del spike
  expect(orderFrame(openIntent(MON, 619, "short", 100, 3), { sn: 4, rq: 7, head: 10 })).toMatchObject({ t: 2, lv: 300, lb: 30, p: 0, fl: 4, ms: 100 });
});

test("closeIntent closes the whole position on the opposite side", () => {
  const long = closeIntent(MON, 619, { mkt: 64, sd: 1, s: 100, ep: 2221, lv: 100 });
  expect(orderFrame(long, { sn: 4, rq: 7, head: 63177651 })).toEqual(frames.sentClose);
  expect(closeIntent(MON, 619, { mkt: 64, sd: 2, s: 250, ep: 2221, lv: 300 })).toMatchObject({ t: 4, s: 250, lv: 300 });
});

test.each([
  [7, 32, undefined, "failed", "Order id too low — try again"],
  [7, 34, undefined, "failed", "One-click trading is off. Enable trading again"],
  [2, 35, undefined, "open", "Placed"],
  [7, 44, 8, "failed", "Not enough collateral for this size"],
  [7, 37, undefined, "failed", "Not enough collateral for this size"],
  [7, 39, undefined, "failed", "Below the market minimum"],
  [7, 40, undefined, "failed", "Price out of range"],
  [7, 42, undefined, "failed", "Size out of range"],
  [4, 43, undefined, "filled", "Filled"],
  [7, 44, undefined, "failed", "Couldn't settle — try a smaller size"],
  [7, 99, undefined, "failed", "Failed (sr 99)"],
  [5, 28, undefined, "failed", "Canceled — nothing filled"],
  [6, 6, undefined, "failed", "Expired before it could fill"],
  [1, 0, undefined, "sent", "Sent"],
])("describeOrderStatus(st %i, sr %s, fr %s)", (st, sr, fr, kind, text) => {
  expect(describeOrderStatus(st, sr, fr)).toEqual({ kind, text });
});

test("formatPrice and formatSize use the market decimals", () => {
  expect(formatPrice(2221, 5)).toBe("0.02221");
  expect(formatPrice(762555, 1)).toBe("76255.5");
  expect(formatSize(100, 0)).toBe("100");
  expect(formatSize(131, 5)).toBe("0.00131");
});

test("lockedCollateral sums the collateral of every position", () => {
  expect(lockedCollateral([])).toBe(0n);
  expect(lockedCollateral([{ c: 10_000_000n }, { c: 2_500_000n }])).toBe(12_500_000n);
});

test("unrealisedPnl sums positionPnl across markets and skips unknown markets", () => {
  const longMon = { mkt: 64, sd: 1 as const, s: 100, ep: 2217, lv: 100 };   // MON mark 2221 → +4000
  const shortMon = { mkt: 64, sd: 2 as const, s: 100, ep: 2217, lv: 100 };  // → −4000
  const orphan = { mkt: 999, sd: 1 as const, s: 100, ep: 1, lv: 100 };
  expect(unrealisedPnl([longMon], [MON, BTC])).toBe(positionPnl(longMon, MON.mark, MON.priceDecimals, MON.sizeDecimals));
  expect(unrealisedPnl([longMon], [MON, BTC])).toBe(4000n);
  expect(unrealisedPnl([shortMon], [MON, BTC])).toBe(-4000n);
  expect(unrealisedPnl([longMon, shortMon], [MON, BTC])).toBe(0n);
  expect(unrealisedPnl([longMon, orphan], [MON, BTC])).toBe(4000n);
  expect(unrealisedPnl([orphan], [MON, BTC])).toBeNull();
  expect(unrealisedPnl([], [MON, BTC])).toBeNull();
});

test("formatPnl rounds anything under half a cent to +0.00 and keeps the sign otherwise", () => {
  expect(formatPnl(0n)).toBe("+0.00");
  expect(formatPnl(-4_999n)).toBe("+0.00");
  expect(formatPnl(4_999n)).toBe("+0.00");
  expect(formatPnl(5_000n)).toBe("+0.00");
  expect(formatPnl(10_000n)).toBe("+0.01");
  expect(formatPnl(-1_500_000n)).toBe("−1.50");
  expect(formatPnl(123_456_789n)).toBe("+123.45");
});

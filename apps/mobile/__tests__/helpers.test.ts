import { AGENTS } from "../src/mock/data";
import { money, pill, quoteFor, sellQuoteFor } from "../src/mock/helpers";
import { C } from "../src/ui/theme";

test("money formats with two decimals by default and thousands separators", () => {
  expect(money(1240)).toBe("1,240.00");
  expect(money(318.4)).toBe("318.40");
  expect(money(5998.2, 1)).toBe("5,998.2");
});

test("buy quote takes 1% fee and 0.15 network from the gross", () => {
  const q = quoteFor(AGENTS.pkl, 250);
  expect(q.gross).toBe(250);
  expect(q.fee).toBeCloseTo(2.5);
  expect(q.network).toBe(0.15);
  expect(q.tokens).toBeCloseTo((250 - 2.5 - 0.15) / 0.0412, 3);
});

test("sell quote sells a percentage of the example 4,820 holding", () => {
  const sq = sellQuoteFor(AGENTS.pkl, 50);
  expect(sq.qty).toBe(2410);
  expect(sq.gross).toBeCloseTo(2410 * 0.0412);
  expect(sq.net).toBeCloseTo(sq.gross - sq.fee - 0.15);
});

test("pill returns the wireframe's active/inactive colours", () => {
  expect(pill(false)).toEqual({ bg: "transparent", fg: C.dim, bd: C.hair2 });
  expect(pill(true)).toEqual({ bg: C.ink, fg: C.onInk, bd: C.ink });
  expect(pill(true, C.lime)).toEqual({ bg: C.lime, fg: C.onLime, bd: C.lime });
});

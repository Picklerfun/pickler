import { appendMarks, type MarkHistory, SPARK_POINTS, sparkPoints } from "../src/perpl/marks";

test("appendMarks keeps the last SPARK_POINTS marks per market without mutating the input (P1)", () => {
  const h0: MarkHistory = {};
  const h1 = appendMarks(h0, [{ id: 16, mark: 100 }, { id: 3, mark: 5 }]);
  expect(h1).toEqual({ 16: [100], 3: [5] });
  expect(h0).toEqual({});
  const h2 = appendMarks(h1, [{ id: 16, mark: 101 }]);
  expect(h2).toEqual({ 16: [100, 101], 3: [5] });
  expect(h1[16]).toEqual([100]);
  let h: MarkHistory = {};
  for (let i = 0; i < SPARK_POINTS + 5; i++) h = appendMarks(h, [{ id: 1, mark: i }]);
  expect(h[1]).toHaveLength(SPARK_POINTS);
  expect(h[1][0]).toBe(5);
  expect(h[1][SPARK_POINTS - 1]).toBe(SPARK_POINTS + 4);
  expect(appendMarks({ 7: [1, 2] }, [{ id: 7, mark: 3 }], 2)[7]).toEqual([2, 3]);
});

test("sparkPoints normalizes to a 0..100 viewBox with y inverted; flat with < 2 or equal marks (P2)", () => {
  expect(sparkPoints([10, 20, 15, 30])).toEqual([[0, 94], [33.3, 50], [66.7, 72], [100, 6]]);
  expect(sparkPoints([7, 7, 7])).toEqual([[0, 50], [50, 50], [100, 50]]);
  expect(sparkPoints([])).toEqual([[0, 50], [100, 50]]);
  expect(sparkPoints([812345])).toEqual([[0, 50], [100, 50]]);
});

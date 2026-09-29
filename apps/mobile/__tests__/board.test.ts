import { BOARD_H, boardCaption, boardRows, cellTone, stickyPhrase, trajectory } from "../src/reads/board";

// BTC con pd 1: mark 762555 = 76,255.5 (mismos números que reads-matrix.test).
const MARK = 762555;

test("rows: 5 levels high to low with the mark band between +0.5% and −0.5% (D10)", () => {
  const rows = boardRows(MARK);
  expect(rows.map((r) => (r.kind === "mark" ? "MARK" : r.bps))).toEqual([250, 100, 50, "MARK", -50, -100]);
  expect(rows[0]).toEqual({ kind: "level", bps: 250, price: 781619, label: "+2.5%", side: "long" });
  expect(rows[4]).toEqual({ kind: "level", bps: -50, price: 758742, label: "−0.5%", side: "short" });
  expect(BOARD_H).toBe(5 * 48 + 26);
});

test("cell tone: above the mark is long, below is short; Ask is always ask", () => {
  expect(cellTone("trade", 100)).toBe("long");
  expect(cellTone("trade", -50)).toBe("short");
  expect(cellTone("ask", -50)).toBe("ask");
});

test("caption: trade phrase with the absolute level; ask phrase; hint without a cell", () => {
  expect(boardCaption("trade", { levelBps: 100, horizonMin: 240 }, MARK, 1)).toEqual({ text: "LONG TO 77018.1 WITHIN 4H", tone: "long" });
  expect(boardCaption("trade", { levelBps: -100, horizonMin: 1440 }, MARK, 1)).toEqual({ text: "SHORT TO 75492.9 WITHIN 24H", tone: "short" });
  expect(boardCaption("ask", { levelBps: 50, horizonMin: 60 }, MARK, 1)).toEqual({ text: "ASK ABOUT 76636.8 WITHIN 1H", tone: "ask" });
  expect(boardCaption("trade", undefined, MARK, 1)).toEqual({ text: "TAP A SQUARE", tone: "none" });
});

test("trajectory: the current mark sits on the band; x spans 0..100", () => {
  const pts = trajectory([MARK, MARK], MARK);
  expect(pts[0][0]).toBe(0);
  expect(pts[1][0]).toBe(100);
  // centro de la banda: (3 × 48 + 13) / 266 = 59.0 %
  expect(pts[1][1]).toBeCloseTo(59.0, 1);
});

test("trajectory: a past mark at +1.0% sits on the +1.0% row centre", () => {
  const up = Math.round((MARK * 10100) / 10000);
  const [[, y]] = trajectory([up, MARK], MARK);
  expect(y).toBeCloseTo((72 / 266) * 100, 1);
});

test("trajectory: marks outside the board are clamped to 2..98 and never NaN (Review Focus 1)", () => {
  const pts = trajectory([MARK * 2, MARK / 2, MARK], MARK);
  expect(pts[0][1]).toBe(2);
  expect(pts[1][1]).toBe(98);
  expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
});

test("trajectory: fewer than 2 marks draws nothing", () => {
  expect(trajectory([], MARK)).toEqual([]);
  expect(trajectory([MARK], MARK)).toEqual([]);
});

test("sticky phrase: with a level it names target and horizon; without, a market order", () => {
  expect(stickyPhrase("long", "BTC", { target: 770181, horizonMin: 240, levelBps: 100 }, 1)).toBe("Long to 77018.1 within 4H");
  expect(stickyPhrase("short", "ETH", undefined, 2)).toBe("Short ETH at market");
});

test("sticky phrase: a side that disagrees with the level's implied side falls back to the plain market order (item 4)", () => {
  // Nivel por encima del mark (levelBps > 0 ⇒ long) con lado Short elegido: "Short to <precio arriba>" sería contradictorio.
  expect(stickyPhrase("short", "BTC", { target: 781619, horizonMin: 60, levelBps: 250 }, 1)).toBe("Short BTC at market");
  // Coincide (levelBps < 0 ⇒ short, lado short): sí se usa el nivel.
  expect(stickyPhrase("short", "BTC", { target: 758742, horizonMin: 60, levelBps: -50 }, 1)).toBe("Short to 75874.2 within 1H");
});

test("caption: an explicit target on the cell is used instead of the mark-derived price (item 2)", () => {
  expect(boardCaption("trade", { levelBps: 100, horizonMin: 240, target: 999999 }, MARK, 1)).toEqual({ text: "LONG TO 99999.9 WITHIN 4H", tone: "long" });
  // Sin target explícito, sigue calculando desde el mark (compatibilidad con Ask).
  expect(boardCaption("trade", { levelBps: 100, horizonMin: 240 }, MARK, 1)).toEqual({ text: "LONG TO 77018.1 WITHIN 4H", tone: "long" });
});

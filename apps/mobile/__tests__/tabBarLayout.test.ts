import { itemWidth, pillWidth, pillX, ROW_BOTTOM, ROW_H, ROW_TOP, tabBarHeight, tabIndexAt } from "../src/ui/tabBarLayout";

// iPhone 17 Pro: 402 pt de ancho; fila con 6 pt de padding a cada lado → 5 ítems de 78 pt.
const W = 402;

test("itemWidth splits the row minus its horizontal padding", () => {
  expect(itemWidth(W)).toBe(78);
  expect(itemWidth(W, 4)).toBe(97.5);
});

test("tabIndexAt maps a finger x to the item under it and clamps at both ends", () => {
  expect(tabIndexAt(0, W)).toBe(0);
  expect(tabIndexAt(-20, W)).toBe(0);
  expect(tabIndexAt(6 + 77.9, W)).toBe(0);
  expect(tabIndexAt(6 + 78, W)).toBe(1);
  expect(tabIndexAt(200, W)).toBe(2);
  expect(tabIndexAt(401, W)).toBe(4);
  expect(tabIndexAt(900, W)).toBe(4);
});

test("pillX and pillWidth sit the pill inside its item with a 2 pt inset", () => {
  expect(pillX(0, W)).toBe(8);
  expect(pillX(2, W)).toBe(6 + 2 * 78 + 2);
  expect(pillX(4, W)).toBe(6 + 4 * 78 + 2);
  expect(pillWidth(W)).toBe(74);
});

test("tabBarHeight is the row plus the bottom inset (deterministic, no measuring)", () => {
  expect(tabBarHeight(0)).toBe(ROW_TOP + ROW_H + ROW_BOTTOM);
  expect(tabBarHeight(34)).toBe(8 + 45 + 34 + 12);
});

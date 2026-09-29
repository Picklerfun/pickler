import { ROW_BOTTOM, ROW_H, ROW_TOP, tabBarHeight } from "../src/ui/tabBarLayout";

test("the bar is 8 + 54 + inset + 8: icon 19, gap 5, label 10.5 and 10 pt of padding on each side", () => {
  expect([ROW_TOP, ROW_H, ROW_BOTTOM]).toEqual([8, 54, 8]);
  expect(tabBarHeight(0)).toBe(70);
  expect(tabBarHeight(34)).toBe(104);
});

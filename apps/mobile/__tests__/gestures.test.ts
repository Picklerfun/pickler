import { BACK_DX, EDGE_PX, shouldCaptureEdgeSwipe, shouldGoBack } from "../src/ui/gestures";

test("only a mostly-horizontal drag that starts at the left edge is captured", () => {
  expect(shouldCaptureEdgeSwipe(0, 10, 2)).toBe(true);
  expect(shouldCaptureEdgeSwipe(EDGE_PX, 10, 2)).toBe(true);
  expect(shouldCaptureEdgeSwipe(EDGE_PX + 1, 10, 2)).toBe(false);
  expect(shouldCaptureEdgeSwipe(5, 4, 8)).toBe(false);   // vertical: es scroll
  expect(shouldCaptureEdgeSwipe(5, -10, 2)).toBe(true);  // se captura y luego no dispara
});

test("back fires only past the drag threshold", () => {
  expect(shouldGoBack(BACK_DX)).toBe(false);
  expect(shouldGoBack(BACK_DX + 1)).toBe(true);
  expect(shouldGoBack(-100)).toBe(false);
});

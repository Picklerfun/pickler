import { BTN_VARIANTS } from "../src/ui/variants";
import { C } from "../src/ui/theme";

test("primary is lime with ink text; ink is the dark CTA; ask is the violet tint", () => {
  expect(BTN_VARIANTS.lime).toEqual({ bg: C.lime, bd: C.lime, fg: C.ink, w: 600 });
  expect(BTN_VARIANTS.ink).toEqual({ bg: C.ink, bd: C.ink, fg: C.onInk, w: 600 });
  expect(BTN_VARIANTS.ask).toEqual({ bg: C.vioBg, bd: C.vioBg, fg: C.vio, w: 600 });
  expect(BTN_VARIANTS.tile).toEqual({ bg: C.tile, bd: C.tile, fg: C.onInk, w: 600 });
});

test("the old outline variants become control fills (the Handoff has no hairline buttons)", () => {
  for (const v of ["outline", "outline2", "outline20"] as const) expect(BTN_VARIANTS[v]).toEqual({ bg: C.ctl, bd: C.ctl, fg: C.ink, w: 600 });
  expect(BTN_VARIANTS.violetSoft).toEqual(BTN_VARIANTS.ask);
  expect(BTN_VARIANTS.violetSoft10).toEqual(BTN_VARIANTS.ask);
});

test("no variant paints lime text", () => {
  for (const v of Object.values(BTN_VARIANTS)) expect(v.fg).not.toBe(C.lime);
});

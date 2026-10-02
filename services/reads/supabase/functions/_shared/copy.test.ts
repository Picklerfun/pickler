import { assertEquals } from "jsr:@std/assert@1";
import { horizonLabel, levelLabel, readResolvedPush, readVoidPush, reminderPush } from "./copy.ts";

const read = { id: "r1", market_id: 16, symbol: "BTC", level_bps: 100, horizon_min: 240, price_decimals: 1, agent_name: "Drift" };

Deno.test("labels", () => {
  assertEquals([60, 240, 720, 1440].map(horizonLabel), ["1H", "4H", "12H", "24H"]);
  assertEquals([250, 50, -50, -100].map(levelLabel), ["+2.5%", "+0.5%", "−0.5%", "−1.0%"]);
});

Deno.test("readResolvedPush y readVoidPush", () => {
  assertEquals(readResolvedPush(read, "right", 771000), {
    token: "", env: "production", title: "BTC +1.0% · 4H", body: "Drift was right · mark 77100.0",
    data: { kind: "read", readId: "r1", marketId: 16 },
  });
  assertEquals(readVoidPush(read).body, "Read voided: Perpl was unavailable at expiry. Your credit is back.");
});

Deno.test("reminderPush: 15 min antes y al vencer", () => {
  const rem = { id: "m1", market_id: 64, symbol: "MON", level_bps: -50, horizon_min: 60, price_decimals: 5, target: 2210, read_id: null };
  assertEquals(reminderPush({ ...rem, kind: "pre" }, 2221), {
    token: "", env: "production", title: "MON −0.5% · 15 min left", body: "MON at 0.02221 · your level 0.02210",
    data: { kind: "reminder", reminderId: "m1", marketId: 64, readId: null },
  });
  assertEquals(reminderPush({ ...rem, kind: "expiry" }, 2200).title, "MON −0.5% · horizon reached");
  assertEquals(reminderPush({ ...rem, kind: "expiry" }, 2200).body, "MON at 0.02200 · your level 0.02210 · close by hand if you're done");
});

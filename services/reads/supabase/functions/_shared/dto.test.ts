import { assertEquals } from "jsr:@std/assert@1";
import { toAgentDto, toReadDto } from "./dto.ts";

Deno.test("toReadDto convierte int8/numeric en número, fechas a ISO y reasons a string[]", () => {
  const dto = toReadDto({
    id: "r1", address: "0xabc", agent_id: "jesus", market_id: 16, symbol: "BTC", level_bps: 100, horizon_min: 240, price_decimals: 1,
    mark_at_request: "762555", target: "770181", question: "q", status: "open", probability: "0.620", reasons: ["a", "b", "c"], limits: "l",
    model: "claude-sonnet-5", latency_ms: 4200, credits_charged: 1, error: null, created_at: new Date("2026-09-20T10:00:00Z"),
    expires_at: new Date("2026-09-20T14:00:00Z"), resolved_at: null, mark_at_resolution: null, outcome: null, brier: null,
  });
  assertEquals(dto.markAtRequest, 762555);
  assertEquals(dto.probability, 0.62);
  assertEquals(dto.reasons, ["a", "b", "c"]);
  assertEquals(dto.expiresAt, "2026-09-20T14:00:00.000Z");
  assertEquals(dto.resolvedAt, null);
  assertEquals("address" in dto, false);
});

Deno.test("toAgentDto arma el récord y nunca incluye persona", () => {
  const dto = toAgentDto({ id: "drift", handle: "drift", name: "Drift", owner: "Pickler", price_credits: 1, reads: "3", resolved: "2", right_count: "1", brier_avg: "0.2100" });
  assertEquals(dto.record, { reads: 3, resolved: 2, right: 1, brierAvg: 0.21 });
  assertEquals("persona" in dto, false);
});

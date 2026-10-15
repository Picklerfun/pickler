import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditUnits,
  priceCreditTokens,
  validateCreditPricing,
  createAiCreditPaymentService,
  type AiCreditRepository,
} from "../src/features/ai-credits/index.js";
const rate = {
  provider: "controlled",
  model: "test",
  inputUnitsPerMillion: "1000001",
  outputUnitsPerMillion: "3000000",
};
test("AI credits use canonical exact integers and reject token/float substitutes", () => {
  assert.equal(creditUnits("999999999999999999999999999999"), 10n ** 30n - 1n);
  for (const value of ["-1", "1.0", "01", "1e6", "", "1".repeat(31)]) {
    assert.throws(() => creditUnits(value), { code: "INVALID_CREDITS" });
  }
});
test("credit prices round up once per call and preserve fractional units", () => {
  assert.equal(priceCreditTokens(rate, 1, 1), "5");
  assert.equal(priceCreditTokens(rate, 0, 0), "0");
  assert.equal(priceCreditTokens(rate, 1000000, 1000000), "4000001");
  for (const n of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => priceCreditTokens(rate, n, 0), { code: "INVALID_USAGE" });
  }
});
test("pricing is reviewed and unique per exact provider/model", () => {
  const pricing = { id: "test", version: "v1", reviewedAt: "2026-10-05T00:00:00Z", rates: [rate] };
  validateCreditPricing(pricing);
  validateCreditPricing({ ...pricing, rates: [] });
  assert.throws(() => validateCreditPricing({ ...pricing, rates: [rate, rate] }), {
    code: "INVALID_PRICING",
  });
  assert.throws(() => validateCreditPricing({ ...pricing, reviewedAt: "bad" }), {
    code: "INVALID_PRICING",
  });
});
test("purchase confirmation always obtains proof from the injected verifier", async () => {
  const calls: string[] = [];
  const proof = { purchaseId: "purchase" };
  const service = createAiCreditPaymentService(
    {
      recordVerifiedPayment: async (input: unknown) => {
        calls.push("record");
        assert.equal(input, proof);
        return input;
      },
    } as unknown as AiCreditRepository,
    {
      verify: async (reference: string) => {
        calls.push("verify");
        assert.equal(reference, "provider_reference");
        return proof;
      },
    } as never,
  );
  await service.confirm("provider_reference");
  assert.deepEqual(calls, ["verify", "record"]);
});

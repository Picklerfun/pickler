import { PilotError, type AdvicePolicy, type AdviceLane } from "@pickler/core";
export const ADVICE_INPUT_TOKENS = 30000;
export const ADVICE_OUTPUT_TOKENS = 2000;
export function usdMicros(value: string): bigint {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(value)) {
    throw new PilotError(
      "ADVICE_POLICY_INVALID",
      "USD value must be an exact decimal with up to six places",
    );
  }
  const [whole, decimals = ""] = value.split(".");
  return BigInt(whole!) * 1000000n + BigInt(decimals.padEnd(6, "0"));
}
export function adviceTokenCost(
  policy: AdvicePolicy,
  lane: "jev" | "deepseek",
  input: number,
  output: number,
): bigint {
  if (![input, output].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new PilotError("MODEL_USAGE_INVALID", "Invalid token usage");
  }
  return (
    (BigInt(input) * usdMicros(policy.inputRates[lane]) +
      BigInt(output) * usdMicros(policy.outputRates[lane]) +
      999999n) /
    1000000n
  );
}
export function adviceReservations(policy: AdvicePolicy, web: boolean): Record<AdviceLane, string> {
  return {
    jev: adviceTokenCost(policy, "jev", ADVICE_INPUT_TOKENS, 0).toString(),
    deepseek: adviceTokenCost(
      policy,
      "deepseek",
      ADVICE_INPUT_TOKENS,
      ADVICE_OUTPUT_TOKENS,
    ).toString(),
    web: (web ? usdMicros(policy.webSearchUsd) : 0n).toString(),
    "web-fallback": (web ? usdMicros(policy.webSearchUsd) : 0n).toString(),
  };
}
export function assertAdvicePolicy(policy: AdvicePolicy) {
  if (
    policy.version !== 1 ||
    policy.jevModel !== "jev-1.13.0" ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(policy.deepseekModel) ||
    usdMicros(policy.outputRates.jev) !== 0n ||
    !policy.pricingSources.length ||
    policy.pricingSources.some((url) => !/^https:\/\//.test(url)) ||
    !Number.isFinite(Date.parse(policy.pricingVerifiedAt))
  ) {
    throw new PilotError("ADVICE_POLICY_INVALID", "Reviewed model pricing is required");
  }
  const maximum = Object.values(adviceReservations(policy, true)).reduce(
    (sum, n) => sum + BigInt(n),
    0n,
  );
  if (
    maximum <= 0n ||
    usdMicros(policy.requestLimitUsd) < maximum ||
    usdMicros(policy.dailyLimitUsd) < usdMicros(policy.requestLimitUsd)
  ) {
    throw new PilotError(
      "ADVICE_POLICY_INVALID",
      "Explicit request and daily limits must cover the reservation",
    );
  }
}

export function parseAdvicePolicy(json: string | undefined): AdvicePolicy | null {
  if (!json) {
    return null;
  }
  try {
    const policy = JSON.parse(json) as AdvicePolicy;
    assertAdvicePolicy(policy);
    return policy;
  } catch {
    return null;
  }
}
export function advicePolicyKey(policy: AdvicePolicy | null) {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, value]) => [k, sort(value)]),
          )
        : v;
  return JSON.stringify(sort(policy));
}

import { PilotError } from "@pickler/core";
import { perpsStrategySnapshot } from "../perps-strategies/registry.js";
import type {
  PerpsProposal,
  PerpsCallLane,
  PerpsModelHooks,
  PerpsStrategyInput,
  PerpsStrategyDependencies,
} from "../perps-strategies/types.js";

/** Frozen v1 readiness -> blind forecast, deliberately absent from the four-way registry. */
export async function executeLegacyPerpsReadiness(
  input: PerpsStrategyInput,
  deps: PerpsStrategyDependencies,
): Promise<PerpsProposal[]> {
  deps.signal.throwIfAborted();
  if (!deps.models.readiness || !deps.models.direct) {
    throw new PilotError("MODEL_CONFIG_MISMATCH", "Historical readiness adapters unavailable");
  }
  const call = <T>(lane: PerpsCallLane, operation: (hooks: PerpsModelHooks) => Promise<T>) => {
    deps.signal.throwIfAborted();
    return deps.calls.run(lane, (hooks) => {
      deps.signal.throwIfAborted();
      return operation(hooks);
    });
  };
  const context = perpsStrategySnapshot(input);
  const result = await call("jev", (hooks) => deps.models.readiness!(context, deps.signal, hooks));
  deps.signal.throwIfAborted();
  if (result.skip) {
    return (["BTC", "ETH"] as const).map((symbol) => ({
      symbol,
      action: "hold",
      reason: "JEV_MATERIAL_INSUFFICIENCY",
      sourceIds: [],
    }));
  }
  const proposals = await call("fallback", (hooks) =>
    deps.models.direct!(context, deps.signal, hooks),
  );
  deps.signal.throwIfAborted();
  return proposals;
}

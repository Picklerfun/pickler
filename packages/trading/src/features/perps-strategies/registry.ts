import { PilotError } from "@pickler/core";
import { perpsRules } from "./policy.js";
import type {
  PerpsDecisionContext,
  PerpsProposal,
  PerpsCallLane,
  PerpsModelHooks,
  PerpsStrategyId,
  PerpsStrategyCapability,
  PerpsStrategyDependencies,
  PerpsStrategyDescriptor,
  PerpsStrategyInput,
  PerpsStrategySelection,
} from "./types.js";

/** These versions name the unchanged strategy policies, not provider or prompt versions. */
function descriptor(
  id: PerpsStrategyId,
  capabilities: PerpsStrategyCapability[],
  version: PerpsStrategyDescriptor["version"] = "1.0.0",
): PerpsStrategyDescriptor {
  return Object.freeze({ id, version, capabilities: Object.freeze(capabilities) });
}

export const PERPS_STRATEGIES: readonly PerpsStrategyDescriptor[] = Object.freeze([
  descriptor("rules", []),
  descriptor("deepseek", ["direct"]),
  descriptor("jev", ["decide"]),
  descriptor("combined", ["direct", "review"]),
  descriptor("rules", [], "2.0.0"),
  descriptor("deepseek", ["direct"], "2.0.0"),
  descriptor("jev", ["decide"], "2.0.0"),
  descriptor("combined", ["direct", "review"], "2.0.0"),
  descriptor("rules", [], "2.1.0"),
  descriptor("deepseek", ["direct"], "2.1.0"),
  descriptor("jev", ["decide"], "2.1.0"),
  descriptor("combined", ["direct", "review"], "2.1.0"),
]);

export function resolvePerpsStrategy(selection: PerpsStrategySelection): PerpsStrategyDescriptor {
  const descriptor = PERPS_STRATEGIES.find(
    (item) => item.id === selection.id && item.version === selection.version,
  );
  if (!descriptor || descriptor.version !== selection.version) {
    throw new PilotError("STRATEGY_UNAVAILABLE", "Unknown perpetual strategy or policy version");
  }
  return descriptor;
}

function freeze(value: unknown): void {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
}

/** Clone first: a provider cannot mutate another strategy's evidence or persisted account. */
export function perpsStrategySnapshot(input: PerpsStrategyInput): PerpsDecisionContext {
  const snapshot = structuredClone(input) as PerpsDecisionContext;
  freeze(snapshot);
  return snapshot;
}

export async function executePerpsStrategy(
  selection: PerpsStrategySelection,
  input: PerpsStrategyInput,
  deps: PerpsStrategyDependencies,
): Promise<PerpsProposal[]> {
  const descriptor = resolvePerpsStrategy(selection);
  if (descriptor.version !== "1.0.0") {
    throw new PilotError(
      "STRATEGY_CONTEXT_MISMATCH",
      "Studio strategies require the versioned Studio context",
    );
  }
  deps.signal.throwIfAborted();
  for (const capability of descriptor.capabilities) {
    if (typeof deps.models[capability] !== "function") {
      throw new PilotError("MODEL_CONFIG_MISMATCH", "Required strategy model adapter unavailable");
    }
  }
  const call = <T>(lane: PerpsCallLane, operation: (hooks: PerpsModelHooks) => Promise<T>) => {
    deps.signal.throwIfAborted();
    return deps.calls.run(lane, (hooks) => {
      deps.signal.throwIfAborted();
      return operation(hooks);
    });
  };
  const context = perpsStrategySnapshot(input);
  if (descriptor.id === "rules") {
    return perpsRules(context);
  }
  if (descriptor.id === "deepseek") {
    const proposals = await call("direct", (hooks) =>
      deps.models.direct!(context, deps.signal, hooks),
    );
    deps.signal.throwIfAborted();
    return proposals;
  }
  if (descriptor.id === "jev") {
    const result = await call("jev", (hooks) => deps.models.decide!(context, deps.signal, hooks));
    deps.signal.throwIfAborted();
    return result.proposals;
  }
  const proposals = await call("fallback", (hooks) =>
    deps.models.direct!(context, deps.signal, hooks),
  );
  deps.signal.throwIfAborted();
  const original = structuredClone(proposals);
  freeze(original);
  const result = await call("review", (hooks) =>
    deps.models.review!(context, original, deps.signal, hooks),
  );
  deps.signal.throwIfAborted();
  return result.proposals;
}

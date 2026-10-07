import { PilotError, type AgentBrief, type AgentSources, type PerpSymbol } from "@pickler/core";
import { perpsJevDecisions, perpsJevReviewed, perpsRules, type PerpsJevAnswers } from "./policy.js";
import { perpsStrategySnapshot, resolvePerpsStrategy } from "./registry.js";
import type {
  DeepReadonly,
  PerpsDecisionContext,
  PerpsModelHooks,
  PerpsProposal,
  PerpsStrategyCalls,
  PerpsStrategySelection,
} from "./types.js";

export interface StudioBriefFinding {
  /** One-based index in the corresponding authored section. */
  index: number;
  state: "met" | "not-met" | "unknown";
  reason: string;
  sourceIds: string[];
}
export interface StudioBriefEvaluation {
  entries: StudioBriefFinding[];
  exits: StudioBriefFinding[];
  never: StudioBriefFinding[];
}
export interface StudioPerpsProposal extends PerpsProposal {
  brief: StudioBriefEvaluation;
}
export interface StudioPerpsContext extends PerpsDecisionContext {
  protocol: "studio-perps-strategy-v2";
  markets: PerpSymbol[];
  strategyVersion?: "2.0.0" | "2.1.0";
  brief: AgentBrief;
  sources: AgentSources;
  /** Untrusted source bodies; references must also occur in evidence.sourceIds. */
  documents: { id: string; text: string }[];
}
export interface StudioPerpsModels {
  preflight?(
    context: StudioPerpsContext,
    capabilities: readonly ("direct" | "decide" | "review")[],
  ): void;
  direct?(
    context: StudioPerpsContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<StudioPerpsProposal[]>;
  decide?(
    context: StudioPerpsContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<{ answers: PerpsJevAnswers; brief: Record<string, StudioBriefEvaluation> }>;
  review?(
    context: StudioPerpsContext,
    proposals: StudioPerpsProposal[],
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<{ answers: PerpsJevAnswers }>;
}

function fail(message: string): never {
  throw new PilotError("STRATEGY_RESPONSE_INVALID", message);
}
function refs(ids: string[], context: StudioPerpsContext): void {
  if (!Array.isArray(ids) || ids.some((id) => !context.evidence.sourceIds.includes(id))) {
    fail("Strategy cites unavailable evidence");
  }
}
function findings(values: StudioBriefFinding[], count: number, context: StudioPerpsContext): void {
  if (!Array.isArray(values) || values.length !== count) {
    fail("Every authored condition requires an explicit evaluation");
  }
  const indexes = new Set<number>();
  for (const value of values) {
    if (
      !Number.isInteger(value.index) ||
      value.index < 1 ||
      value.index > count ||
      indexes.has(value.index) ||
      !["met", "not-met", "unknown"].includes(value.state) ||
      typeof value.reason !== "string" ||
      !value.reason.trim()
    ) {
      fail("Invalid brief condition evaluation");
    }
    indexes.add(value.index);
    refs(value.sourceIds, context);
    if (value.state !== "unknown" && !value.sourceIds.length) {
      fail("Known condition evaluation requires evidence");
    }
  }
}

/** Unknown conditions cannot establish an entry or an authored exit. */
export function admitStudioBrief(
  proposal: StudioPerpsProposal,
  context: StudioPerpsContext,
): StudioPerpsProposal {
  if (!context.markets.includes(proposal.symbol)) {
    fail("Strategy proposed an unauthorized market");
  }
  if (
    Object.keys(proposal).some(
      (key) => !["symbol", "action", "reason", "sourceIds", "brief"].includes(key),
    )
  ) {
    fail("Strategy response contains unsupported fields");
  }
  if (!proposal.brief || !["hold", "close", "open-long", "open-short"].includes(proposal.action)) {
    fail("Invalid strategy action or missing brief evaluation");
  }
  if (typeof proposal.reason !== "string" || !proposal.reason.trim()) {
    fail("Strategy reason is required");
  }
  refs(proposal.sourceIds, context);
  if (proposal.action !== "hold" && !proposal.sourceIds.length) {
    fail("Action requires concrete evidence");
  }
  findings(proposal.brief.entries, context.brief.entersWhen.length, context);
  findings(proposal.brief.exits, context.brief.exitsWhen.length, context);
  findings(proposal.brief.never, context.brief.never.length, context);
  const position = context.account.positions.find(
    (p) => p.symbol === proposal.symbol && p.closedAt === null,
  );
  if (position && proposal.brief.exits.some((finding) => finding.state === "met")) {
    return { ...proposal, action: "close", reason: "STUDIO_BRIEF_EXIT_MET" };
  }
  if (proposal.action === "open-long" || proposal.action === "open-short") {
    if (
      proposal.brief.entries.some((finding) => finding.state !== "met") ||
      proposal.brief.never.some((finding) => finding.state !== "not-met")
    ) {
      return { ...proposal, action: "hold", reason: "STUDIO_BRIEF_UNSUPPORTED" };
    }
    if (position) {
      const side = proposal.action === "open-long" ? "long" : "short";
      return {
        ...proposal,
        action: position.side === side ? "hold" : "close",
        reason: position.side === side ? "ALREADY_OPEN" : "OPPOSITE_SIGNAL_CLOSE_ONLY",
      };
    }
  }
  return proposal;
}
function complete(
  proposals: StudioPerpsProposal[],
  context: StudioPerpsContext,
): StudioPerpsProposal[] {
  if (
    !Array.isArray(proposals) ||
    proposals.length !== context.markets.length ||
    new Set(proposals.map((p) => p.symbol)).size !== context.markets.length
  ) {
    fail("Strategy must return exactly one proposal per authorized market");
  }
  return proposals.map((proposal) => admitStudioBrief(proposal, context));
}

function validateJev(
  answers: PerpsJevAnswers,
  markets: readonly PerpSymbol[],
  review: boolean,
): void {
  for (const symbol of markets) {
    for (const kind of review ? ["identity", "evidence", "costs"] : ["long", "short", "thesis"]) {
      const answer = answers[`${symbol}_${kind}`];
      const labels = review
        ? ["CONSISTENT", "CONTRADICTED", "UNKNOWN"]
        : kind === "thesis"
          ? ["INVALIDATED", "INTACT", "UNKNOWN"]
          : ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "UNKNOWN"];
      if (
        !answer ||
        !labels.includes(answer.choice) ||
        !Number.isFinite(answer.confidence) ||
        answer.confidence < 0 ||
        answer.confidence > 1 ||
        !answer.probabilities ||
        !Number.isFinite(answer.probabilities[answer.choice]) ||
        answer.probabilities[answer.choice]! < 0 ||
        answer.probabilities[answer.choice]! > 1
      ) {
        throw new PilotError("JEV_ANSWERS_INVALID", "Invalid Studio atomic answer");
      }
    }
  }
}

/** Version 2 is product-specific; version 1 remains the unchanged laboratory protocol. */
export async function executeStudioPerpsStrategy(
  selection: PerpsStrategySelection,
  input: DeepReadonly<StudioPerpsContext>,
  dependencies: { models: StudioPerpsModels; calls: PerpsStrategyCalls; signal: AbortSignal },
): Promise<StudioPerpsProposal[]> {
  const descriptor = resolvePerpsStrategy(selection);
  if (
    !["2.0.0", "2.1.0"].includes(descriptor.version) ||
    input.protocol !== "studio-perps-strategy-v2" ||
    (input.strategyVersion !== undefined && input.strategyVersion !== descriptor.version)
  ) {
    throw new PilotError(
      "STRATEGY_CONTEXT_MISMATCH",
      "Studio requires a matching versioned strategy context",
    );
  }
  const { signal, models, calls } = dependencies;
  signal.throwIfAborted();
  for (const capability of descriptor.capabilities) {
    if (typeof models[capability] !== "function") {
      throw new PilotError("MODEL_CONFIG_MISMATCH", "Required Studio adapter unavailable");
    }
  }
  const context = perpsStrategySnapshot(input) as StudioPerpsContext;
  if (
    !context.markets.length ||
    new Set(context.markets).size !== context.markets.length ||
    context.markets.some((symbol) => !/^[A-Z0-9][A-Z0-9._-]{0,31}(?![\s\S])/.test(symbol)) ||
    (descriptor.version === "2.0.0" &&
      context.markets.some((symbol) => !["BTC", "ETH"].includes(symbol)))
  ) {
    throw new PilotError("STRATEGY_CONTEXT_MISMATCH", "Invalid authorized markets");
  }
  if (descriptor.id === "rules") {
    if (
      context.brief.entersWhen.length ||
      context.brief.exitsWhen.length ||
      context.brief.never.length
    ) {
      throw new PilotError(
        "RULES_BRIEF_UNSUPPORTED",
        "SMA rules cannot verify free-text conditions",
      );
    }
    return complete(
      perpsRules(context, context.markets).map((proposal) => ({
        ...proposal,
        brief: { entries: [], exits: [], never: [] },
      })),
      context,
    );
  }
  if (!context.brief.entersWhen.length) {
    throw new PilotError("INVALID_BRIEF", "AI strategies require authored entry conditions");
  }
  const call = async <T>(
    lane: "direct" | "jev" | "fallback" | "review",
    operation: (hooks: PerpsModelHooks) => Promise<T>,
  ) => {
    signal.throwIfAborted();
    const result = await calls.run(lane, (hooks) => {
      signal.throwIfAborted();
      return operation(hooks);
    });
    signal.throwIfAborted();
    return result;
  };
  if (descriptor.id === "jev") {
    const result = await call("jev", (hooks) => models.decide!(context, signal, hooks));
    validateJev(result.answers, context.markets, false);
    return complete(
      perpsJevDecisions(context, result.answers, context.markets).map((proposal) => ({
        ...proposal,
        brief: result.brief[proposal.symbol]!,
      })),
      context,
    );
  }
  const original = await call(descriptor.id === "deepseek" ? "direct" : "fallback", (hooks) =>
    models.direct!(context, signal, hooks),
  );
  // Validate without applying brief exits before review: a material veto must not be undone.
  complete(original, context);
  if (descriptor.id === "deepseek") {
    return complete(original, context);
  }
  const immutable = perpsStrategySnapshot({
    evidence: context.evidence,
    account: context.account,
    proposals: original,
  } as PerpsDecisionContext & { proposals: StudioPerpsProposal[] }) as PerpsDecisionContext & {
    proposals: StudioPerpsProposal[];
  };
  const review = await call("review", (hooks) =>
    models.review!(context, immutable.proposals, signal, hooks),
  );
  validateJev(review.answers, context.markets, true);
  const reviewed = perpsJevReviewed(original, review.answers) as StudioPerpsProposal[];
  return reviewed.map((proposal) => {
    const admitted = admitStudioBrief(proposal, context);
    return proposal.reason === "JEV_MATERIAL_VETO" ? proposal : admitted;
  });
}

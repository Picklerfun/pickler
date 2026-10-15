import { runTokenIndexer, tokenIndexerPolicySchema } from "@pickler/infrastructure";

type Pass = Awaited<ReturnType<typeof runTokenIndexer>>;
type StopReason = "caught_up" | "pass_limit" | "busy" | "gap" | "reorg";

/** Scheduling only: each infrastructure pass owns its lease, RPC quota and canonical writes. */
export async function runScheduledTokenIndexing(input: {
  policy: string;
  runPass: () => Promise<Pass>;
}) {
  const policy = tokenIndexerPolicySchema.parse(JSON.parse(input.policy));
  const limit = policy.version === 2 ? policy.maxPassesPerTick : 1;
  const passes: Pass[] = [];
  let stopReason: StopReason = "pass_limit";

  for (let index = 0; index < limit; index++) {
    const pass = await input.runPass();
    passes.push(pass);

    if (!("outcomes" in pass)) {
      stopReason = "busy";
      break;
    }
    const interruption = pass.outcomes.find(
      (outcome) => outcome.kind === "gap" || outcome.kind === "reorg",
    );
    if (interruption?.kind === "gap" || interruption?.kind === "reorg") {
      stopReason = interruption.kind;
      break;
    }
    if (pass.caughtUp) {
      stopReason = "caught_up";
      break;
    }
  }

  return { passes, stopReason };
}

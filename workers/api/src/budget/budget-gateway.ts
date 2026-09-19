import type { AgentLedger, LedgerSnapshot } from "./agent-ledger";

/** What routes need from the ledger; tests provide an in-memory implementation. */
export interface BudgetGateway {
  snapshot(agentId: string): Promise<LedgerSnapshot>;
}

export function createDurableBudgetGateway(
  namespace: DurableObjectNamespace<AgentLedger>,
): BudgetGateway {
  const stub = (agentId: string) => namespace.get(namespace.idFromName(agentId));
  return {
    snapshot: (agentId) => stub(agentId).snapshot(agentId),
  };
}

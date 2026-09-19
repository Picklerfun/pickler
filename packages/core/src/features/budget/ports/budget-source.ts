/** Read-only view of the budget rows Relayer keeps in `agent.agent_budgets`. */
export interface BudgetSource {
  loadBudgets(agentId: string): Promise<{ category: string; limit: string; spent: string }[]>;
}

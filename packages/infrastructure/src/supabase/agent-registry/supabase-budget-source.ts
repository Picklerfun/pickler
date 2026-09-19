// Ported from Relayer kits/agent/repositories/AgentBudgetRepository.ts#findByAgentId (commit bb6bb1226e92).
// Reads budget.budgets for ledger hydration.

import { DataSourceUnavailableError, type BudgetSource } from "@pickler/core";
import type { SupabaseAdmin } from "../supabase-admin-client.js";

export function createSupabaseBudgetSource(db: SupabaseAdmin): BudgetSource {
  return {
    async loadBudgets(agentId) {
      const { data, error } = await db
        .schema("budget")
        .from("budgets")
        .select("category, limit_micro_usd, spent_micro_usd")
        .eq("agent_id", agentId)
        .returns<
          { category: string; limit_micro_usd: string | number; spent_micro_usd: string | number }[]
        >();
      if (error) {
        throw new DataSourceUnavailableError("supabase.budget.budgets", {
          cause: new Error(error.message),
        });
      }
      return (data ?? []).map((row) => ({
        category: row.category,
        limit: String(row.limit_micro_usd),
        spent: String(row.spent_micro_usd),
      }));
    },
  };
}

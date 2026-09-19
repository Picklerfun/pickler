// Ported from Relayer apps/api/src/kits/agent/agent.controller.ts read endpoints
// (commit bb6bb1226e92). Write endpoints (draft/prepare/confirm, kill, pause, budget, signing)
// arrive with the Turnkey and budget waves.

import { AccessDeniedError, type createAgentQueries } from "@pickler/core";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { BudgetGateway } from "../budget/budget-gateway";
import { agentDto, analyticsDto, auditDto, budgetDto } from "../http/agent-dto";
import { successEnvelope } from "../http/envelope";
import { agentScoped, type AgentScopedServices } from "../middleware/agent-auth";
import { authenticated, requireModule, requirePermission } from "../middleware/auth";

export interface AgentRouteServices extends AgentScopedServices {
  agentQueries: ReturnType<typeof createAgentQueries>;
  budgets: BudgetGateway;
}

export function agentRoutes(services: AgentRouteServices) {
  const readAgents = [
    authenticated(services.authenticate),
    requireModule("agent"),
    requirePermission("read", "Agent"),
  ] as const;
  const workspaceId = (c: { get(key: "workspace"): { id: string } | null }) => {
    const workspace = c.get("workspace");
    if (!workspace) {
      throw new AccessDeniedError("No integrator context");
    }
    return workspace.id;
  };

  return new Hono<AppEnv>()
    .get("/", ...readAgents, async (c) => {
      const agents = await services.agentQueries.listAgents(workspaceId(c));
      return c.json(successEnvelope(agents.map(agentDto), c.req.path, "Agents retrieved"));
    })
    .get("/:id/status", agentScoped(services, { self: true }), async (c) => {
      const status = await services.agentQueries.getStatus(workspaceId(c), c.req.param("id"));
      return c.json(successEnvelope(status, c.req.path, "Agent status retrieved"));
    })
    .get("/:id/analytics", agentScoped(services, { self: true }), async (c) => {
      const analytics = await services.agentQueries.getAnalytics(
        workspaceId(c),
        c.req.param("id"),
        c.req.query("period") ?? null,
      );
      return c.json(successEnvelope(analyticsDto(analytics), c.req.path, "Analytics retrieved"));
    })
    .get("/:id/budget", agentScoped(services, { self: true }), async (c) => {
      // Tenant check first, so a ledger is never created for an agent outside the workspace.
      const agent = await services.agentQueries.getAgent(workspaceId(c), c.req.param("id"));
      return c.json(
        successEnvelope(
          budgetDto(agent.id, await services.budgets.snapshot(agent.id)),
          c.req.path,
          "Budget retrieved",
        ),
      );
    })
    .get("/:id/audit", ...readAgents, async (c) => {
      const page = await services.agentQueries.getAudit(workspaceId(c), c.req.param("id"), {
        page: c.req.query("page") ?? null,
        limit: c.req.query("limit") ?? null,
        type: c.req.query("type") ?? null,
        period: c.req.query("period") ?? null,
        status: c.req.query("status") ?? null,
      });
      return c.json(successEnvelope(auditDto(page), c.req.path, "Audit history retrieved"));
    })
    .get("/:id", ...readAgents, async (c) => {
      const agent = await services.agentQueries.getAgent(workspaceId(c), c.req.param("id"));
      return c.json(successEnvelope(agentDto(agent), c.req.path, "Agent retrieved"));
    });
}

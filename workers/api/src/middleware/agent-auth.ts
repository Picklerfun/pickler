// Ported from Relayer kits/agent/guards/{agent-auth,agent-or-integrator-auth}.guard.ts and the
// @AgentScoped / @AgentSelfAccess decorators (commit bb6bb1226e92).
// Behaviour change: on the user/API-key path, agent-scoped routes also require the `agent`
// module and `read Agent`, like every other agent route. Relayer skipped both checks, so any
// member of the workspace (including viewers) could read status and analytics.

import { AccessDeniedError, type AgentPrincipal, type AgentRequest } from "@pickler/core";
import { every } from "hono/combine";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { authenticated, requireModule, requirePermission, type Authenticate } from "./auth";

export type AuthenticateAgent = (request: AgentRequest) => Promise<AgentPrincipal>;
export type FindWorkspace = (id: string) => Promise<import("@pickler/core").Workspace | null>;

export interface AgentScopedServices {
  authenticate: Authenticate;
  authenticateAgent: AuthenticateAgent;
  findWorkspace: FindWorkspace;
}

const hasAgentHeaders = (header: (name: string) => string | undefined) =>
  Boolean(header("x-agent-id") || header("x-agent-auth"));

/** HMAC-signed agent requests only. */
export function agentOnly(
  services: Pick<AgentScopedServices, "authenticateAgent" | "findWorkspace">,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = await services.authenticateAgent({
      agentId: c.req.header("x-agent-id") ?? null,
      signature: c.req.header("x-agent-auth") ?? null,
      timestamp: c.req.header("x-request-timestamp") ?? null,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      // Hono caches the body, so handlers can still read it afterwards.
      body: c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text(),
    });
    c.set("principal", principal);
    c.set("workspace", await services.findWorkspace(principal.tenantId));
    await next();
  });
}

/**
 * Agent SDK (HMAC) or dashboard/integrator (JWT, API key). With `self`, an agent may only
 * reach routes whose `:id` is its own id.
 */
export function agentScoped(services: AgentScopedServices, options: { self?: boolean } = {}) {
  const viaAgent = agentOnly(services);
  const viaIntegrator = every(
    authenticated(services.authenticate),
    requireModule("agent"),
    requirePermission("read", "Agent"),
  );

  return createMiddleware<AppEnv>(async (c, next) => {
    if (hasAgentHeaders((name) => c.req.header(name))) {
      await viaAgent(c, async () => {
        const id = c.req.param("id");
        if (options.self && id && id !== c.get("principal").id) {
          throw new AccessDeniedError("Agent can only access its own resources");
        }
        await next();
      });
      return;
    }
    await viaIntegrator(c, next);
  });
}

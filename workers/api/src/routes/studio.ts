import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  createStudioAccess,
  MARKET_CATALOG,
  DEFAULT_CONFIG,
  PLUGINS,
  PilotError,
  AccessDeniedError,
  AuthenticationRequiredError,
  unsupported,
  type AgentDrafter,
  type StudioDirectory,
  type ResearchRepository,
} from "@pickler/core";
import {
  createAgentSchema,
  studioOptionsSchema,
  idempotencyKeySchema,
  agentResponseSchema,
  configUpdateSchema,
  runRequestSchema,
  runResponseSchema,
  eventResponseSchema,
  pauseSchema,
  paperOrderSchema,
  scheduleSchema,
  draftRequestSchema,
  draftResponseSchema,
} from "@pickler/api-schema";
import { DraftUnavailableError } from "@pickler/infrastructure";
import type { AppEnv } from "../env";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface StudioServices {
  authenticate: Authenticate;
  directory: StudioDirectory;
  repository: ResearchRepository;
  admissionsEnabled?: boolean;
  notifyQueued(): Promise<void>;
  /** Null when no model is configured; drafting then answers 503 rather than guessing. */
  drafter?: AgentDrafter | null;
  paper?: {
    create(tenantId: string, runId: string, key: string): Promise<unknown>;
    get(tenantId: string, runId: string): Promise<unknown>;
  };
}

function pilotStatus(code: string): 400 | 404 | 409 | 429 | 503 {
  if (code === "NOT_FOUND") {
    return 404;
  }
  if (code === "QUOTA") {
    return 429;
  }
  if (code === "INVALID_INPUT") {
    return 400;
  }
  if (code === "DRAFT_UNAVAILABLE") {
    return 503;
  }
  return 409;
}

/** JWT-only private transport. Tenant identifiers always come from persisted membership. */
export function studioRoutes(services: StudioServices) {
  const api = new Hono<AppEnv>();
  const access = createStudioAccess(services.directory);
  const repo = services.repository;
  api.use("*", bodyLimit({ maxSize: 16_384 }));
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  api.use("*", authenticated(services.authenticate, { userOnly: true }));
  api.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return c.json({ error: "INVALID_INPUT" }, 400);
    }
    if (error instanceof AuthenticationRequiredError) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    if (error instanceof AccessDeniedError) {
      return c.json({ error: "RESEARCH_ACCESS_DENIED" }, 403);
    }
    if (error instanceof PilotError) {
      return c.json({ error: error.code }, pilotStatus(error.code));
    }
    return c.json({ error: "INTERNAL_OR_PROVIDER_FAILURE" }, 500);
  });
  api.post("/onboard", async (c) => {
    await services.directory.onboard(c.get("principal").id);
    return c.json({ ok: true });
  });
  api.get("/me", async (c) => {
    const principal = c.get("principal");
    const current = await access.authorize(principal);
    return c.json({
      workspaceId: current.workspaceId,
      enabled: current.enabled,
      canManage: current.enabled && current.ownerUserId === principal.id,
    });
  });
  api.get("/options", (c) => {
    const defaults = { ...DEFAULT_CONFIG };
    delete defaults.categoryIds;
    return c.json(studioOptionsSchema.parse({ defaults, plugins: PLUGINS }));
  });
  api.get("/market-categories", (c) => c.json(MARKET_CATALOG));
  api.get("/agents", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const agents = await services.directory.list(current);
    return c.json({
      agents: await Promise.all(
        agents.map(async (agent) => ({
          ...agentResponseSchema.parse(await repo.agent(agent.scope)),
          productId: agent.id,
          name: agent.name,
          handle: agent.handle,
        })),
      ),
    });
  });
  api.post("/agents", async (c) => {
    const input = createAgentSchema.parse(await c.req.json());
    const scope = await access.create(c.get("principal"), {
      ...input,
      key: idempotencyKeySchema.parse(c.req.header("Idempotency-Key")),
    });
    return c.json(agentResponseSchema.parse(await repo.agent(scope)), 201);
  });
  // Before the /agents/:id routes, so "draft" is never read as an agent id.
  // Drafting spends a model call and exists only to create, so it needs the same rights as creating.
  api.post("/agents/draft", async (c) => {
    await access.authorize(c.get("principal"), true);
    if (!services.drafter) {
      throw new PilotError("DRAFT_UNAVAILABLE", "No model is configured for drafting");
    }
    const { line } = draftRequestSchema.parse(await c.req.json());
    try {
      const draft = await services.drafter.draft(line);
      return c.json(draftResponseSchema.parse({ draft, unsupported: unsupported(draft) }));
    } catch (caught) {
      if (caught instanceof DraftUnavailableError) {
        // The cause stays server-side; it never carries the key or the request.
        const cause = caught.cause instanceof Error ? caught.cause.message : String(caught.cause);
        console.error("Draft unavailable", {
          requestId: c.get("requestId"),
          message: caught.message,
          cause,
        });
        throw new PilotError("DRAFT_UNAVAILABLE", caught.message);
      }
      throw caught;
    }
  });
  api.get("/agents/:id", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    return c.json(agentResponseSchema.parse(await repo.agent(scope)));
  });
  api.put("/agents/:id/config", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    const body = configUpdateSchema.parse(await c.req.json());
    if (!body.config.marketScope) {
      throw new PilotError("INVALID_INPUT", "Category selection required");
    }
    return c.json(
      agentResponseSchema.parse(await repo.updateConfig(scope, body.expectedVersion, body.config)),
    );
  });
  api.get("/agents/:id/runs", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    const raw = c.req.query("before");
    const before =
      raw === undefined ? null : z.coerce.number().int().nonnegative().safe().parse(raw);
    const ids = await services.directory.runs(scope, before);
    return c.json({
      runs: await Promise.all(
        ids.map(async (id) => runResponseSchema.parse(await repo.run(scope.tenantId, id))),
      ),
    });
  });
  api.post("/agents/:id/runs", async (c) => {
    if (services.admissionsEnabled === false) {
      throw new PilotError("ADMISSIONS_PAUSED", "New research is paused");
    }
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    const body = runRequestSchema.parse(await c.req.json());
    const run = await repo.enqueue(
      scope,
      idempotencyKeySchema.parse(c.req.header("Idempotency-Key")),
      body.marketId ?? null,
      Date.now(),
    );
    if (run.status === "queued") {
      try {
        await services.notifyQueued();
      } catch {
        console.error("Durable admission awaits queue reconciliation");
      }
    }
    return c.json({ runId: run.id, status: run.status }, 202);
  });
  api.get("/runs/:id", async (c) => {
    const current = await access.authorize(c.get("principal"));
    return c.json(runResponseSchema.parse(await repo.run(current.tenantId, c.req.param("id"))));
  });
  api.get("/runs/:id/events", async (c) => {
    const current = await access.authorize(c.get("principal"));
    return c.json({
      events: eventResponseSchema
        .array()
        .parse(await repo.events(current.tenantId, c.req.param("id"))),
    });
  });
  api.post("/runs/:id/paper-order", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    if (!services.paper) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Paper trading unavailable");
    }
    const raw = await c.req.text();
    if (raw) {
      z.object({}).strict().parse(JSON.parse(raw));
    }
    const order = paperOrderSchema.parse(
      await services.paper.create(
        current.tenantId,
        c.req.param("id"),
        idempotencyKeySchema.parse(c.req.header("Idempotency-Key")),
      ),
    );
    return c.json(order, order.status === "pending" ? 202 : 200);
  });
  api.get("/runs/:id/paper-order", async (c) => {
    const current = await access.authorize(c.get("principal"));
    if (!services.paper) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Paper trading unavailable");
    }
    return c.json(
      paperOrderSchema.parse(await services.paper.get(current.tenantId, c.req.param("id"))),
    );
  });
  api.put("/agents/:id/pause", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    await repo.pause(scope, pauseSchema.parse(await c.req.json()).paused);
    return c.json({ ok: true });
  });
  api.put("/agents/:id/schedule", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    await repo.schedule(scope, scheduleSchema.parse(await c.req.json()).enabled, Date.now());
    return c.json({ ok: true });
  });
  return api;
}

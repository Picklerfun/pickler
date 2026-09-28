import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  createConsoleAccess,
  MARKET_CATALOG,
  DEFAULT_CONFIG,
  PLUGINS,
  PilotError,
  AccessDeniedError,
  AuthenticationRequiredError,
  type ConsoleDirectory,
  type ResearchRepository,
} from "@pickler/core";
import { type TradingRepository } from "@pickler/trading/polymarket";
import {
  createAgentSchema,
  consoleOptionsSchema,
  idempotencyKeySchema,
  agentResponseSchema,
  configUpdateSchema,
  runRequestSchema,
  runResponseSchema,
  eventResponseSchema,
  pauseSchema,
  paperOrderSchema,
  paperSummarySchema,
  scheduleSchema,
  liveBuySchema,
  liveOrderSchema,
  tradingAccountSchema,
} from "@pickler/api-schema";
import type { AppEnv } from "../env";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface ConsoleServices {
  trading?: {
    repository: TradingRepository;
    admissionsEnabled: boolean;
    invoke(path: string, input: unknown): Promise<Response>;
    notify(): Promise<void>;
  };
  authenticate: Authenticate;
  directory: ConsoleDirectory;
  repository: ResearchRepository;
  admissionsEnabled?: boolean;
  notifyQueued(): Promise<void>;
  paper?: {
    create(tenantId: string, runId: string, key: string): Promise<unknown>;
    get(tenantId: string, runId: string): Promise<unknown>;
    settle?(tenantId: string, runId: string): Promise<unknown>;
    summary?(scope: { tenantId: string; agentId: string }): Promise<unknown>;
  };
}

/** JWT-only private transport. Tenant identifiers always come from persisted membership. */
export function consoleRoutes(services: ConsoleServices) {
  const api = new Hono<AppEnv>();
  const access = createConsoleAccess(services.directory);
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
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "QUOTA"
            ? 429
            : error.code === "INVALID_INPUT"
              ? 400
              : 409;
      return c.json({ error: error.code }, status);
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
    return c.json(consoleOptionsSchema.parse({ defaults, plugins: PLUGINS }));
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
  api.get("/agents/:id", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    return c.json(agentResponseSchema.parse(await repo.agent(scope)));
  });
  api.put("/agents/:id/config", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    const body = configUpdateSchema.parse(await c.req.json());
    if (
      body.config.trading?.mode === "automatic" &&
      (await repo.agent(scope)).config.trading?.mode !== "automatic"
    ) {
      if (!services.trading || !(await services.trading.repository.account(scope)).enabled) {
        throw new PilotError("TRADING_DISABLED", "Trading access required");
      }
      const orders = await services.trading.repository.list(scope);
      if (!orders.some((order) => order.origin === "manual" && order.status === "settled")) {
        throw new PilotError("TRADING_MANUAL_REQUIRED", "Confirm a manual purchase first");
      }
    }
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
  api.post("/runs/:id/paper-order/settle", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    if (!services.paper?.settle) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Paper settlement unavailable");
    }
    const raw = await c.req.text();
    if (raw) {
      z.object({}).strict().parse(JSON.parse(raw));
    }
    return c.json(
      paperOrderSchema.parse(await services.paper.settle(current.tenantId, c.req.param("id"))),
    );
  });
  api.get("/agents/:id/paper-summary", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    if (!services.paper?.summary) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Paper summary unavailable");
    }
    return c.json(paperSummarySchema.parse(await services.paper.summary(scope)));
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
  api.get("/agents/:id/trading/account", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    if (!services.trading) {
      throw new PilotError("TRADING_NOT_CONFIGURED", "Trading unavailable");
    }
    return c.json(tradingAccountSchema.parse(await services.trading.repository.account(scope)));
  });
  api.get("/agents/:id/trading/orders", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    if (!services.trading) {
      throw new PilotError("TRADING_NOT_CONFIGURED", "Trading unavailable");
    }
    return c.json({
      orders: liveOrderSchema.array().parse(await services.trading.repository.list(scope)),
    });
  });
  api.get("/agents/:id/trading/positions", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    if (!services.trading) {
      throw new PilotError("TRADING_NOT_CONFIGURED", "Trading unavailable");
    }
    const orders = await services.trading.repository.list(scope);
    return c.json({
      positions: liveOrderSchema
        .array()
        .parse(orders.filter((order) => order.status === "settled")),
    });
  });
  api.get("/trading/orders/:id", async (c) => {
    const current = await access.authorize(c.get("principal"));
    if (!services.trading) {
      throw new PilotError("TRADING_NOT_CONFIGURED", "Trading unavailable");
    }
    return c.json(
      liveOrderSchema.parse(
        await services.trading.repository.get(current.tenantId, c.req.param("id")),
      ),
    );
  });
  for (const operation of ["check", "prepare"] as const) {
    api.post(`/agents/:id/trading/${operation}`, async (c) => {
      const current = await access.authorize(c.get("principal"), true);
      const scope = await services.directory.agentScope(current, c.req.param("id"));
      if (!services.trading || (!services.trading.admissionsEnabled && operation !== "check")) {
        throw new PilotError("TRADING_ADMISSIONS_PAUSED", "Trading paused");
      }
      const key = idempotencyKeySchema.parse(c.req.header("Idempotency-Key"));
      const body = await c.req.json();
      const request =
        operation === "prepare" ? liveBuySchema.parse(body) : z.object({}).strict().parse(body);
      const response = await services.trading.invoke(`/${operation}`, {
        scope,
        key,
        ...(operation === "prepare" ? { request } : {}),
      });
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    });
  }
  api.post("/trading/orders/:id/submit", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    z.object({})
      .strict()
      .parse(await c.req.json());
    if (!services.trading?.admissionsEnabled) {
      throw new PilotError("TRADING_ADMISSIONS_PAUSED", "Trading paused");
    }
    const order = await services.trading.repository.enqueue(
      current.tenantId,
      c.req.param("id"),
      idempotencyKeySchema.parse(c.req.header("Idempotency-Key")),
    );
    try {
      await services.trading.notify();
    } catch {
      console.error("Trading notification awaits reconciliation");
    }
    return c.json(liveOrderSchema.parse(order), 202);
  });
  api.post("/runs/:id/live-order", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    z.object({})
      .strict()
      .parse(await c.req.json());
    if (!services.trading?.admissionsEnabled) {
      throw new PilotError("TRADING_ADMISSIONS_PAUSED", "Trading paused");
    }
    const run = await repo.run(current.tenantId, c.req.param("id"));
    const response = await services.trading.invoke("/from-run", {
      scope: { tenantId: current.tenantId, agentId: run.agentId },
      runId: run.id,
      key: idempotencyKeySchema.parse(c.req.header("Idempotency-Key")),
    });
    return new Response(response.body, {
      status: response.ok ? 202 : response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  });
  return api;
}

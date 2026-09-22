import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  MARKET_CATALOG,
  type createTradingService,
  PilotError,
  type ResearchRepository,
  type MarketData,
} from "@pickler/core";
import {
  liveBuySchema,
  liveOrderSchema,
  tradingAccountSchema,
  marketCatalogSchema,
  agentResponseSchema,
  runResponseSchema,
  eventResponseSchema,
  configUpdateSchema,
  runRequestSchema,
  scheduleSchema,
  pauseSchema,
  paperOrderSchema,
} from "@pickler/api-schema";

function errorStatus(code: string): 400 | 404 | 409 | 429 | 502 {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "QUOTA":
      return 429;
    case "INVALID_INPUT":
      return 400;
    case "INVALID_PROVIDER_RESPONSE":
      return 502;
    default:
      return code.startsWith("PROVIDER") ? 502 : 409;
  }
}

export function createApi(deps: {
  trading?: ReturnType<typeof createTradingService> | undefined;
  repository: ResearchRepository;
  markets: MarketData;
  tokens: Record<string, string>;
  checkConnections(): Promise<unknown>;
  notifyQueued?(): Promise<void>;
  paper?: {
    create(tenantId: string, runId: string, key: string): Promise<unknown>;
    get(tenantId: string, runId: string): Promise<unknown>;
  };
  checkPlugin?(scope: { tenantId: string; agentId: string }, plugin: string): Promise<unknown>;
}) {
  const api = new Hono<{ Variables: { tenant: string } }>();
  api.use("*", bodyLimit({ maxSize: 16_384 }));
  api.use("*", async (c, next) => {
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
    const tenant = Object.entries(deps.tokens).find(
      ([, value]) =>
        Buffer.byteLength(token) === Buffer.byteLength(value) &&
        timingSafeEqual(Buffer.from(token), Buffer.from(value)),
    )?.[0];
    if (!tenant) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    c.header("Cache-Control", "no-store");
    c.set("tenant", tenant);
    await next();
  });
  api.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return c.json({ error: "INVALID_INPUT" }, 400);
    }
    if (error instanceof PilotError) {
      return c.json({ error: error.code }, errorStatus(error.code));
    }
    return c.json({ error: "INTERNAL_OR_PROVIDER_FAILURE" }, 500);
  });
  const repo = deps.repository;
  api.get("/market-categories", (c) => c.json(marketCatalogSchema.parse(MARKET_CATALOG)));
  api.get("/categories", async (c) =>
    c.json({
      categories: await deps.markets.categories(AbortSignal.timeout(20_000)),
      catalogLimit: 100,
    }),
  );
  api.get("/agents", async (c) =>
    c.json({ agents: agentResponseSchema.array().parse(await repo.agents(c.get("tenant"))) }),
  );
  api.get("/agents/:id", async (c) =>
    c.json(
      agentResponseSchema.parse(
        await repo.agent({ tenantId: c.get("tenant"), agentId: c.req.param("id") }),
      ),
    ),
  );
  api.put("/agents/:id/config", async (c) => {
    const body = configUpdateSchema.parse(await c.req.json());
    return c.json(
      agentResponseSchema.parse(
        await repo.updateConfig(
          { tenantId: c.get("tenant"), agentId: c.req.param("id") },
          body.expectedVersion,
          body.config,
        ),
      ),
    );
  });
  api.post("/agents/:id/runs", async (c) => {
    const body = runRequestSchema.parse(await c.req.json());
    const run = await repo.enqueue(
      { tenantId: c.get("tenant"), agentId: c.req.param("id") },
      c.req.header("Idempotency-Key") ?? "",
      body.marketId ?? null,
      Date.now(),
    );
    if (run.status === "queued" && deps.notifyQueued) {
      try {
        await deps.notifyQueued();
      } catch {
        // Admission is durable. The scheduler will retry the wakeup, not the research.
        console.error("Research wakeup failed; durable job awaits reconciliation");
      }
    }
    return c.json({ runId: run.id, status: run.status }, 202);
  });
  api.get("/runs/:id", async (c) =>
    c.json(runResponseSchema.parse(await repo.run(c.get("tenant"), c.req.param("id")))),
  );
  api.post("/runs/:id/paper-order", async (c) => {
    if (!deps.paper) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Paper service unavailable");
    }
    const raw = await c.req.text();
    if (raw) {
      z.object({}).strict().parse(JSON.parse(raw));
    }
    const result = paperOrderSchema.parse(
      await deps.paper.create(
        c.get("tenant"),
        c.req.param("id"),
        c.req.header("Idempotency-Key") ?? "",
      ),
    );
    return c.json(result, result.status === "pending" ? 202 : 200);
  });
  api.get("/runs/:id/paper-order", async (c) => {
    if (!deps.paper) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Paper service unavailable");
    }
    return c.json(paperOrderSchema.parse(await deps.paper.get(c.get("tenant"), c.req.param("id"))));
  });
  const trading = () => {
    if (!deps.trading) {
      throw new PilotError("TRADING_DISABLED", "Trading runtime is not enabled");
    }
    return deps.trading;
  };
  api.get("/agents/:id/trading/account", async (c) =>
    c.json(
      tradingAccountSchema.parse(
        await trading().account({ tenantId: c.get("tenant"), agentId: c.req.param("id") }),
      ),
    ),
  );
  api.get("/agents/:id/trading/orders", async (c) =>
    c.json({
      orders: liveOrderSchema
        .array()
        .parse(await trading().list({ tenantId: c.get("tenant"), agentId: c.req.param("id") })),
    }),
  );
  api.get("/agents/:id/trading/positions", async (c) =>
    c.json({
      positions: liveOrderSchema
        .array()
        .parse(
          (await trading().list({ tenantId: c.get("tenant"), agentId: c.req.param("id") })).filter(
            (o) => o.status === "settled",
          ),
        ),
    }),
  );
  api.post("/agents/:id/trading/prepare", async (c) =>
    c.json(
      liveOrderSchema.parse(
        await trading().prepare(
          { tenantId: c.get("tenant"), agentId: c.req.param("id") },
          liveBuySchema.parse(await c.req.json()),
          c.req.header("Idempotency-Key") ?? "",
        ),
      ),
      201,
    ),
  );
  api.get("/trading/orders/:id", async (c) =>
    c.json(liveOrderSchema.parse(await trading().get(c.get("tenant"), c.req.param("id")))),
  );
  api.post("/trading/orders/:id/submit", async (c) => {
    const text = await c.req.text();
    if (text) {
      z.object({}).strict().parse(JSON.parse(text));
    }
    return c.json(
      liveOrderSchema.parse(
        await trading().submit(
          c.get("tenant"),
          c.req.param("id"),
          c.req.header("Idempotency-Key") ?? "",
        ),
      ),
      202,
    );
  });
  api.post("/runs/:id/live-order", async (c) => {
    const text = await c.req.text();
    if (text) {
      z.object({}).strict().parse(JSON.parse(text));
    }
    return c.json(
      liveOrderSchema.parse(
        await trading().fromRun(
          c.get("tenant"),
          c.req.param("id"),
          c.req.header("Idempotency-Key") ?? "",
        ),
      ),
      202,
    );
  });
  api.get("/runs/:id/events", async (c) =>
    c.json({
      events: eventResponseSchema
        .array()
        .parse(await repo.events(c.get("tenant"), c.req.param("id"))),
    }),
  );
  api.put("/agents/:id/schedule", async (c) => {
    const { enabled } = scheduleSchema.parse(await c.req.json());
    await repo.schedule(
      { tenantId: c.get("tenant"), agentId: c.req.param("id") },
      enabled,
      Date.now(),
    );
    return c.json({ ok: true });
  });
  api.put("/agents/:id/pause", async (c) => {
    const { paused } = pauseSchema.parse(await c.req.json());
    await repo.pause({ tenantId: c.get("tenant"), agentId: c.req.param("id") }, paused);
    return c.json({ ok: true });
  });
  api.post("/agents/:id/plugins/:plugin/check", async (c) => {
    if (!deps.checkPlugin) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Plugin checks unavailable");
    }
    return c.json(
      await deps.checkPlugin(
        { tenantId: c.get("tenant"), agentId: c.req.param("id") },
        c.req.param("plugin"),
      ),
    );
  });
  // Explicit operator-triggered paid diagnostics; never called at startup.
  api.post("/connections/check", async (c) => c.json(await deps.checkConnections()));
  return api;
}

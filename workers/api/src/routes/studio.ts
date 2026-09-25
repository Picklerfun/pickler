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
  canCreateAnother,
  canSchedule,
  isReadyToSchedule,
  type AgentDrafter,
  type AgentWallet,
  type Lock,
  type Scope,
  type StudioAccess,
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
  studioAgentSchema,
  type StudioAgentDto,
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
  /** The wallet linked to an agent at creation, by product agent id. */
  wallets: { findAgentWallet(agentId: string): Promise<AgentWallet | null> };
  /** The AUSD display balance of an address. A read that fails throws; it is never zero. */
  balances: { read(address: string): Promise<number> };
}

type FundedWallet = AgentWallet & { balanceAusd: number };

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
  /** The linked wallet and its balance. A failed balance read propagates as an error. */
  async function fundedWallet(productId: string): Promise<FundedWallet | null> {
    const wallet = await services.wallets.findAgentWallet(productId);
    if (!wallet) {
      return null;
    }
    return { ...wallet, balanceAusd: await services.balances.read(wallet.address) };
  }

  /**
   * Every agent the person owns, with its wallet, and the "+ New agent" lock over them. An agent
   * without a linked wallet (created before wallets existed) cannot be funded and is not counted.
   */
  async function fleet(current: StudioAccess) {
    const listed = await services.directory.list(current);
    const wallets = await Promise.all(listed.map((agent) => fundedWallet(agent.id)));
    const balances = wallets.flatMap((wallet) => (wallet ? [wallet.balanceAusd] : []));
    return { listed, wallets, another: canCreateAnother(balances) };
  }

  /** The single place the agent DTO, its wallet and both locks are composed. */
  async function studioAgent(
    scope: Scope,
    wallet: FundedWallet | null,
    another: Lock,
    identity: { productId?: string; name?: string; handle?: string },
  ): Promise<StudioAgentDto> {
    const record = await repo.agent(scope);
    const ready = isReadyToSchedule(record, await repo.readiness(scope));
    return studioAgentSchema.parse({
      ...agentResponseSchema.parse(record),
      ...identity,
      wallet: wallet && {
        walletId: wallet.walletId,
        address: wallet.address,
        balanceAusd: wallet.balanceAusd,
      },
      canSchedule: canSchedule({ ready, balanceAusd: wallet?.balanceAusd ?? 0 }),
      canCreateAnother: another,
    });
  }

  api.get("/agents", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const { listed, wallets, another } = await fleet(current);
    return c.json({
      agents: await Promise.all(
        listed.map((agent, index) =>
          studioAgent(agent.scope, wallets[index] ?? null, another, {
            productId: agent.id,
            name: agent.name,
            handle: agent.handle,
          }),
        ),
      ),
    });
  });
  api.post("/agents", async (c) => {
    const input = createAgentSchema.parse(await c.req.json());
    const current = await access.authorize(c.get("principal"), true);
    const { another } = await fleet(current);
    if (!another.ok) {
      throw new PilotError("UNFUNDED_AGENT", "Fund your other agent first");
    }
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
    const productId = c.req.param("id");
    const scope = await services.directory.agentScope(current, productId);
    const { listed, wallets, another } = await fleet(current);
    const index = listed.findIndex((agent) => agent.id === productId);
    const listedAgent = listed[index];
    const wallet = listedAgent ? (wallets[index] ?? null) : await fundedWallet(productId);
    const identity = listedAgent
      ? { productId, name: listedAgent.name, handle: listedAgent.handle }
      : {};
    return c.json(await studioAgent(scope, wallet, another, identity));
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
    const productId = c.req.param("id");
    const scope = await services.directory.agentScope(current, productId);
    const { enabled } = scheduleSchema.parse(await c.req.json());
    if (enabled) {
      // NOT_READY (first run) stays the repository's refusal, inside its transaction; the
      // funding lock is checked here because the balance lives on chain, not in the database.
      const record = await repo.agent(scope);
      const ready = isReadyToSchedule(record, await repo.readiness(scope));
      const wallet = await fundedWallet(productId);
      const lock = canSchedule({ ready, balanceAusd: wallet?.balanceAusd ?? 0 });
      if (lock.reason === "unfunded") {
        throw new PilotError("NOT_FUNDED", "Fund its wallet · min. 10 AUSD");
      }
    }
    await repo.schedule(scope, enabled, Date.now());
    return c.json({ ok: true });
  });
  return api;
}

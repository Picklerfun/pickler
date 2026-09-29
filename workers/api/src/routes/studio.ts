import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  createStudioAccess,
  MARKET_CATALOG,
  DEFAULT_CONFIG,
  PLUGINS,
  PilotError,
  BriefError,
  PreviewRateLimited,
  preparePreview,
  AccessDeniedError,
  AuthenticationRequiredError,
  unsupported,
  canCreateAnother,
  MAX_DRAFTS_PER_WORKSPACE,
  canSchedule,
  isReadyToSchedule,
  SPEND_ENFORCED,
  AgentWalletNotFoundError,
  DepositAlreadyRecordedError,
  DepositFeeTooHighError,
  DepositNonceError,
  DepositNotSendableError,
  DepositsUnavailableError,
  InvalidDepositAmountError,
  InvalidSignedActivityError,
  NoCustodyAccountError,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  SignedTransactionMismatchError,
  type createCustodyService,
  type AgentDrafter,
  type Accent,
  type AgentWallet,
  type Lock,
  type Scope,
  type StudioAccess,
  type StudioDirectory,
  type PreviewRepository,
  type ResearchRepository,
  type TradingRepository,
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
  paperSummarySchema,
  scheduleSchema,
  liveBuySchema,
  liveOrderSchema,
  tradingAccountSchema,
  draftRequestSchema,
  draftResponseSchema,
  studioAgentSchema,
  limitsUpdateSchema,
  previewRunRequestSchema,
  previewRunResponseSchema,
  draftCreateSchema,
  type StudioAgentDto,
} from "@pickler/api-schema";
import { DraftUnavailableError } from "@pickler/infrastructure";
import type { AppEnv } from "../env";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface StudioServices {
  trading?: {
    repository: TradingRepository;
    admissionsEnabled: boolean;
    invoke(path: string, input: unknown): Promise<Response>;
    notify(): Promise<void>;
  };
  authenticate: Authenticate;
  directory: StudioDirectory;
  repository: ResearchRepository;
  admissionsEnabled?: boolean;
  notifyQueued(): Promise<void>;
  /**
   * Paper runs of a brief that is not an agent yet (studio-brief-v1 §4). Absent where it is not
   * composed; the preview routes then answer 503 PREVIEW_UNAVAILABLE and nothing else changes.
   */
  previews?: PreviewRepository;
  /** Null when no model is configured; drafting then answers 503 rather than guessing. */
  drafter?: AgentDrafter | null;
  paper?: {
    create(tenantId: string, runId: string, key: string): Promise<unknown>;
    get(tenantId: string, runId: string): Promise<unknown>;
    settle?(tenantId: string, runId: string): Promise<unknown>;
    summary?(scope: { tenantId: string; agentId: string }): Promise<unknown>;
  };
  /** The wallet linked to an agent at creation, by product agent id. */
  wallets: { findAgentWallet(agentId: string): Promise<AgentWallet | null> };
  /**
   * The AUSD display balance of an address. A read that fails throws; it is never zero. Where the
   * chain is not composed it throws `PilotError` BALANCES_UNAVAILABLE (503).
   */
  balances: { read(address: string): Promise<number> };
  /**
   * The passkey custody service, per request, for deposits. Absent where Turnkey is not
   * configured; the deposit routes then answer 503 and nothing else changes.
   */
  custody?: (
    requestId: string,
  ) => Pick<ReturnType<typeof createCustodyService>, "prepareDeposit" | "confirmDeposit">;
}

/** The request the browser stamped, in the shape Turnkey's own stamper produces. */
const signedActivitySchema = z
  .object({
    url: z.string().min(1).max(512),
    body: z.string().min(1).max(8192),
    stamp: z
      .object({
        stampHeaderName: z.string().min(1).max(64),
        stampHeaderValue: z.string().min(1).max(8192),
      })
      .strict(),
  })
  .strict();

/** Whole AUSD; core decides which amounts are offered. */
const depositAmountSchema = z.number().int().positive();
const depositPrepareSchema = z.object({ amountAusd: depositAmountSchema }).strict();
const depositConfirmSchema = z
  .object({ amountAusd: depositAmountSchema, signed: signedActivitySchema })
  .strict();

/** The intervals "Run on its own" offers: every 3h, 6h, 12h, or daily. */
const intervalUpdateSchema = z
  .object({ hours: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)]) })
  .strict();

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
  if (code === "PREVIEW_UNAVAILABLE") {
    return 503;
  }
  if (code === "BALANCES_UNAVAILABLE") {
    return 503;
  }
  return 409;
}

/** The deposit ceremony's failures, as this route family's bare codes. */
function custodyFailure(
  error: unknown,
): { code: string; status: 400 | 404 | 409 | 502 | 503 } | null {
  if (error instanceof InvalidDepositAmountError) {
    return { code: "INVALID_INPUT", status: 400 };
  }
  if (error instanceof InvalidSignedActivityError) {
    return { code: "INVALID_SIGNED_ACTIVITY", status: 400 };
  }
  if (error instanceof DepositNonceError) {
    return { code: "DEPOSIT_NONCE_MISMATCH", status: 400 };
  }
  if (error instanceof DepositFeeTooHighError) {
    return { code: "DEPOSIT_FEE_TOO_HIGH", status: 400 };
  }
  if (error instanceof SignedActivityRejectedError) {
    return { code: "SIGNED_ACTIVITY_REJECTED", status: 400 };
  }
  if (error instanceof AgentWalletNotFoundError) {
    return { code: "AGENT_WALLET_NOT_FOUND", status: 404 };
  }
  if (error instanceof NoCustodyAccountError) {
    return { code: "NO_CUSTODY_ACCOUNT", status: 409 };
  }
  if (error instanceof DepositNotSendableError) {
    return { code: "DEPOSIT_NOT_SENDABLE", status: 409 };
  }
  if (error instanceof DepositAlreadyRecordedError) {
    return { code: "DEPOSIT_ALREADY_RECORDED", status: 409 };
  }
  if (error instanceof SigningServiceUnavailableError) {
    return { code: "SIGNING_UNAVAILABLE", status: 502 };
  }
  if (error instanceof DepositsUnavailableError) {
    return { code: "DEPOSITS_UNAVAILABLE", status: 503 };
  }
  return null;
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
    if (error instanceof BriefError) {
      return c.json({ error: error.code, field: error.field, reason: error.reason }, 400);
    }
    if (error instanceof PreviewRateLimited) {
      return c.json({ error: error.code, retryAt: error.retryAt }, 429);
    }
    if (error instanceof PilotError) {
      return c.json({ error: error.code }, pilotStatus(error.code));
    }
    if (error instanceof SignedTransactionMismatchError) {
      // Turnkey answered a transaction other than the approved one; nothing was broadcast. The
      // message names fields only, never the transaction or key material.
      console.error("Signed deposit transaction mismatch", {
        requestId: c.get("requestId"),
        message: error.message,
      });
      return c.json({ error: "INTERNAL_OR_PROVIDER_FAILURE" }, 500);
    }
    const custody = custodyFailure(error);
    if (custody) {
      return c.json({ error: custody.code }, custody.status);
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

  function previewRepository(): PreviewRepository {
    if (!services.previews) {
      throw new PilotError("PREVIEW_UNAVAILABLE", "Paper runs are not composed here");
    }
    return services.previews;
  }

  // "Run it on paper" (studio-brief-v1 §4): the real runtime, once, on a config that is not an
  // agent yet. Research rights, like any run; 5 per rolling hour; readable by its owner for 24 h.
  api.post("/preview-runs", async (c) => {
    if (services.admissionsEnabled === false) {
      throw new PilotError("ADMISSIONS_PAUSED", "New research is paused");
    }
    const principal = c.get("principal");
    const current = await access.authorize(principal, true);
    const previews = previewRepository();
    const { config, fingerprint } = preparePreview(
      previewRunRequestSchema.parse(await c.req.json()),
    );
    const { id } = await previews.create(
      {
        userId: principal.id,
        workspaceId: current.workspaceId,
        tenantId: current.tenantId,
        config,
        fingerprint,
      },
      Date.now(),
    );
    try {
      await services.notifyQueued();
    } catch {
      console.error("Durable admission awaits queue reconciliation");
    }
    return c.json({ id }, 202);
  });
  api.get("/preview-runs/:id", async (c) => {
    const principal = c.get("principal");
    await access.authorize(principal);
    const read = await previewRepository().read(principal.id, c.req.param("id"), Date.now());
    return c.json(previewRunResponseSchema.parse(read));
  });
  /** The linked wallet and its balance. A failed balance read propagates as an error. */
  async function fundedWallet(productId: string): Promise<FundedWallet | null> {
    const wallet = await services.wallets.findAgentWallet(productId);
    if (!wallet) {
      return null;
    }
    return { ...wallet, balanceAusd: await services.balances.read(wallet.address) };
  }

  /**
   * Every agent the person owns, with its wallet, and the "+ New agent" lock over them. The lock
   * counts the balances of agents that have a wallet. A private draft has none and is not counted
   * as unfunded (§6); drafts close the lock only at `MAX_DRAFTS_PER_WORKSPACE`. An agent without a
   * wallet that is not a draft (created before wallets existed) cannot be funded and is not
   * counted either.
   */
  async function fleet(current: StudioAccess) {
    const listed = await services.directory.list(current);
    const wallets = await Promise.all(listed.map((agent) => fundedWallet(agent.id)));
    const balances = wallets.flatMap((wallet) => (wallet ? [wallet.balanceAusd] : []));
    const drafts = listed.filter((agent) => agent.draft).length;
    return { listed, wallets, another: canCreateAnother(balances, drafts) };
  }

  /**
   * "+ New agent"'s lock as the create runs it: inside its transaction, after the workspace row is
   * locked, so two concurrent creates serialize and the second counts the first. Creating an agent
   * with its wallet meets the funding lock alone; a draft also meets the draft limit.
   */
  function fundingLock(current: StudioAccess, creating: "agent" | "draft") {
    return async () => {
      const { another } = await fleet(current);
      if (another.reason === "unfunded_agent") {
        throw new PilotError("UNFUNDED_AGENT", "Fund your other agent first");
      }
      if (another.reason === "draft_limit" && creating === "draft") {
        throw new PilotError("DRAFT_LIMIT", `At most ${MAX_DRAFTS_PER_WORKSPACE} drafts at a time`);
      }
    };
  }

  /**
   * The same lock for one agent's page. Its own balance is already read; the other agents' are
   * read here, and one that cannot be read is left out: an unknown balance is not an unfunded
   * agent, and another agent's failed read does not fail this page. A create decides again with
   * `fundingLock`, where every read must succeed.
   */
  async function lockSeenFrom(
    listed: Awaited<ReturnType<StudioDirectory["list"]>>,
    productId: string,
    own: FundedWallet | null,
  ) {
    const others = listed.filter((agent) => agent.id !== productId);
    const linked = await Promise.all(
      others.map((agent) => services.wallets.findAgentWallet(agent.id)),
    );
    const read = await Promise.allSettled(
      linked.flatMap((wallet) => (wallet ? [services.balances.read(wallet.address)] : [])),
    );
    const known = read.flatMap((balance) =>
      balance.status === "fulfilled" ? [balance.value] : [],
    );
    const balances = own ? [own.balanceAusd, ...known] : known;
    const drafts = listed.filter((agent) => agent.draft).length;
    return canCreateAnother(balances, drafts);
  }

  /** The single place the agent DTO, its wallet and both locks are composed. */
  async function studioAgent(
    scope: Scope,
    wallet: FundedWallet | null,
    another: Lock,
    identity: {
      productId?: string;
      name?: string;
      handle?: string;
      accent: Accent;
      draft: boolean;
    },
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
      spend: record.config.spend ?? null,
      spendEnforced: SPEND_ENFORCED,
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
            accent: agent.accent,
            draft: agent.draft,
          }),
        ),
      ),
    });
  });
  api.post("/agents", async (c) => {
    const input = createAgentSchema.parse(await c.req.json());
    const key = idempotencyKeySchema.parse(c.req.header("Idempotency-Key"));
    const current = await access.authorize(c.get("principal"), true);
    let scope;
    try {
      // A retry of a create that already happened replays inside `create` (which still refuses
      // different terms under the key) before the funding lock; only a genuinely new agent meets it.
      scope = await access.create(
        c.get("principal"),
        { ...input, key },
        fundingLock(current, "agent"),
      );
    } catch (error) {
      // Creation's refusals share one code for different fixes ("Approve the wallet's rules
      // first", "That wallet already belongs to an agent", "Wallet not found", a taken handle), so
      // this route alone sends the directory's message along for the studio to show.
      if (
        error instanceof PilotError &&
        (error.code === "CONFLICT" || error.code === "NOT_FOUND")
      ) {
        return c.json({ error: error.code, message: error.message }, pilotStatus(error.code));
      }
      throw error;
    }
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
  // "Create {Name}" (studio-brief-v1 §6): adopt the paper run as a private draft. Not
  // /agents/draft, which is the model drafter above. The brief travels again, is checked exactly as
  // the run's was, and its fingerprint must match the run's (RUN_STALE otherwise).
  api.post("/drafts", async (c) => {
    const principal = c.get("principal");
    const current = await access.authorize(principal, true);
    const body = draftCreateSchema.parse(await c.req.json());
    const { fingerprint } = preparePreview(body);
    let created;
    try {
      created = await services.directory.createDraft(
        current,
        principal.id,
        { name: body.name, handle: body.handle, previewRunId: body.previewRunId, fingerprint },
        Date.now(),
        fundingLock(current, "draft"),
      );
    } catch (error) {
      // The limit is a number the person has to read, so this refusal alone carries its message.
      if (error instanceof PilotError && error.code === "DRAFT_LIMIT") {
        return c.json({ error: error.code, message: error.message }, pilotStatus(error.code));
      }
      throw error;
    }
    return c.json(
      {
        productId: created.productId,
        agent: agentResponseSchema.parse(await repo.agent(created.scope)),
      },
      201,
    );
  });
  api.get("/agents/:id", async (c) => {
    const current = await access.authorize(c.get("principal"));
    const productId = c.req.param("id");
    const scope = await services.directory.agentScope(current, productId);
    const listed = await services.directory.list(current);
    const listedAgent = listed.find((agent) => agent.id === productId);
    // This agent's own balance is what the page shows, so its failed read fails the request.
    const wallet = await fundedWallet(productId);
    const another = await lockSeenFrom(listed, productId, wallet);
    const identity = listedAgent
      ? {
          productId,
          name: listedAgent.name,
          handle: listedAgent.handle,
          accent: listedAgent.accent,
          draft: listedAgent.draft,
        }
      : { accent: "lime" as const, draft: false };
    return c.json(await studioAgent(scope, wallet, another, identity));
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
  // Spend limits write only `config.spend`: the version, the schedule and readiness stay, because
  // the deposit sheet sets them right before the schedule is turned on. Paper orders enforce them.
  api.put("/agents/:id/limits", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    const body = limitsUpdateSchema.parse(await c.req.json());
    const spend = { perCallAusd: body.perCallAusd, perDayAusd: body.perDayAusd };
    return c.json(agentResponseSchema.parse(await repo.updateSpend(scope, spend)));
  });
  // The interval writes only `config.intervalHours`, like the limits and for the same reason: the
  // person picks it right before turning the schedule on, and a new version would lock the
  // schedule again until another manual run. `PUT /config` may still change it with a new version.
  api.put("/agents/:id/interval", async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const scope = await services.directory.agentScope(current, c.req.param("id"));
    const { hours } = intervalUpdateSchema.parse(await c.req.json());
    return c.json(agentResponseSchema.parse(await repo.updateInterval(scope, hours, Date.now())));
  });
  /** The custody service for this request, or 503 where Turnkey is not composed. */
  function deposits(requestId: string) {
    if (!services.custody) {
      throw new DepositsUnavailableError();
    }
    return services.custody(requestId);
  }

  // Funding an agent (docs/specs/studio-create-and-fund-v1.md §6.2): prepare → passkey stamp in
  // the browser → confirm, which forwards, broadcasts and records. The agent must be the caller's
  // (agentScope); core checks again that its wallet is theirs and that the stamped transfer pays
  // exactly this amount to it.
  api.post("/agents/:id/deposit/prepare", async (c) => {
    const principal = c.get("principal");
    const current = await access.authorize(principal, true);
    const productId = c.req.param("id");
    await services.directory.agentScope(current, productId);
    const { amountAusd } = depositPrepareSchema.parse(await c.req.json());
    const unsigned = await deposits(c.get("requestId")).prepareDeposit(
      principal.id,
      productId,
      amountAusd,
    );
    return c.json({
      url: unsigned.url,
      body: unsigned.body,
      timestampMs: unsigned.timestampMs,
      organizationId: unsigned.organizationId,
      amountMicroUsd: Number(unsigned.amountMicroUsd),
    });
  });
  api.post("/agents/:id/deposit/confirm", async (c) => {
    const principal = c.get("principal");
    const current = await access.authorize(principal, true);
    const productId = c.req.param("id");
    await services.directory.agentScope(current, productId);
    const { amountAusd, signed } = depositConfirmSchema.parse(await c.req.json());
    const { txHash } = await deposits(c.get("requestId")).confirmDeposit(
      principal.id,
      productId,
      amountAusd,
      signed,
    );
    return c.json({ txHash });
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

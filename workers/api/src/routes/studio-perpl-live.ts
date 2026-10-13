import { Hono } from "hono";
import { z } from "zod";
import * as dto from "@pickler/api-schema";
import {
  PilotError,
  type Principal,
  type StudioDirectory,
  type createStudioAccess,
} from "@pickler/core";
import type { AppEnv } from "../env";
import { operation } from "../openapi/operation";

export interface StudioPerplLiveServices {
  invoke(path: string, input: unknown, authorization: string): Promise<Response>;
}
export function studioPerplLiveRoutes(deps: {
  directory: StudioDirectory;
  access: ReturnType<typeof createStudioAccess>;
  service?: StudioPerplLiveServices;
}) {
  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  async function scope(principal: Principal, id: string, increasing: boolean) {
    z.string().uuid().parse(id);
    const access = await deps.access.authorize(principal, increasing);
    if (principal.kind !== "user" || access.ownerUserId !== principal.id) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    await deps.directory.agentScope(access, id);
    return { userId: principal.id, productAgentId: id };
  }
  api.get(
    "/agents/:id/perpl",
    operation("studioPerplLiveState", {
      security: "user",
      response: dto.perplLiveStateSchema,
      errors: dto.studioErrorSchema,
      description:
        "Owner-only real Perpl testnet account, bounded session, positions and verified transaction hashes. Separate from paper trading; no credential or private signal configuration is returned.",
    }),
    async (c) => {
      const owner = await scope(c.get("principal"), c.req.param("id"), false);
      if (!deps.service) {
        return c.json(
          dto.perplLiveStateSchema.parse({
            available: false,
            admissionsEnabled: false,
            network: "testnet",
            address: null,
            accountId: null,
            setupRequired: true,
            keyExpiresAt: null,
            setup: [],
            session: null,
            balanceAusd: null,
            observedAt: null,
            positions: [],
            orders: [],
          }),
        );
      }
      const response = await deps.service.invoke(
        "/perpl/state",
        { scope: owner },
        c.req.header("Authorization") ?? "",
      );
      const body = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify(dto.studioErrorSchema.parse(body)), {
          status: response.status,
          headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        });
      }
      return c.json(dto.perplLiveStateSchema.parse(body));
    },
  );
  const definitions = [
    {
      path: "setup/prepare",
      id: "studioPerplSetupPrepare",
      schema: dto.perplLiveSetupRequestSchema,
      response: dto.perplLiveSetupSchema,
      status: 200,
      key: true,
      description:
        "Prepare one enumerated owner-passkey Perpl account step. The server selects the agent wallet, exchange, exact collateral and key scopes; preparation sends no transaction.",
    },
    {
      path: "setup/confirm",
      id: "studioPerplSetupConfirm",
      schema: dto.perplLiveConfirmSchema,
      response: dto.perplLiveSetupSchema,
      status: 200,
      key: false,
      description:
        "Confirm the exact prepared owner-passkey activity once. Uncertain signing, enrollment or broadcast remains pending; repeated confirms never create another signature.",
    },
    {
      path: "start",
      id: "studioPerplStartTrading",
      schema: dto.perplLiveStartSchema,
      response: dto.perplLiveStateSchema,
      status: 202,
      key: true,
      description:
        "Start a bounded real Perpl testnet session with fixed margin, 1x leverage, one simultaneous position and 1–3 cycles. Requires owner JWT, prepared account and independent Perpl admissions.",
    },
    {
      path: "control",
      id: "studioPerplTradingControl",
      schema: dto.perplLiveControlSchema,
      response: dto.perplLiveStateSchema,
      status: 202,
      key: false,
      description:
        "Pause or resume entries, or request closure and stop. Reducing actions remain available to the owner while new-entry admissions are disabled; accepted closure is not a confirmed fill.",
    },
  ];
  for (const definition of definitions) {
    api.post(
      `/agents/:id/perpl/${definition.path}`,
      operation(definition.id, {
        security: "user",
        body: definition.schema,
        response: definition.response,
        status: definition.status,
        idempotent: definition.key,
        errors: dto.studioErrorSchema,
        description: definition.description,
      }),
      async (c) => {
        const body = definition.schema.parse(await c.req.json());
        const increasing =
          definition.path !== "control" ||
          dto.perplLiveControlSchema.parse(body).action === "resume";
        const owner = await scope(c.get("principal"), c.req.param("id"), increasing);
        if (!deps.service) {
          return c.json({ error: "PERPL_UNAVAILABLE" }, 503);
        }
        const key = definition.key
          ? dto.idempotencyKeySchema.parse(c.req.header("Idempotency-Key"))
          : undefined;
        const response = await deps.service.invoke(
          `/perpl/${definition.path}`,
          { scope: owner, input: body, ...(key ? { key } : {}) },
          c.req.header("Authorization") ?? "",
        );
        const raw = await response.json();
        const output = response.ok
          ? definition.response.parse(raw)
          : dto.studioErrorSchema.parse(raw);
        return new Response(JSON.stringify(output), {
          status: response.status,
          headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        });
      },
    );
  }
  return api;
}

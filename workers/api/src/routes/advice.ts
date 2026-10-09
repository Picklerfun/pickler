import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  PilotError,
  type AdviceJob,
  type createAdviceService,
  type createPaidAdvice,
} from "@pickler/core";
import * as dto from "@pickler/api-schema";
import type { AppEnv } from "../env";
import { authenticated, type Authenticate } from "../middleware/auth";
import { operation } from "../openapi/operation";
import { HttpError } from "../http/http-error";
import { successEnvelope } from "../http/envelope";
export interface AdviceRouteServices {
  authenticate: Authenticate;
  service: ReturnType<typeof createAdviceService>;
  /** Present only when ADVICE_X402_ENABLED composes it; absent, a fresh analysis is free. */
  paid?: ReturnType<typeof createPaidAdvice>;
  notify(): Promise<void>;
}
const PAYMENT_HEADER_REQUIRED = "X-PAYMENT header is required";
function notForSale(error: PilotError): boolean {
  return error.code === "NOT_FOUND" && error.message === "ADVICE_NOT_FOR_SALE";
}
function publicJob(job: AdviceJob) {
  let error: "ANALYSIS_FAILED" | "ANALYSIS_EXPIRED" | "ANALYSIS_INTERRUPTED" | null = null;
  if (job.status === "failed") {
    error = "ANALYSIS_FAILED";
    if (job.error === "ANALYSIS_EXPIRED" || job.error === "ANALYSIS_INTERRUPTED") {
      error = job.error;
    }
  }
  return dto.adviceRecommendationSchema.parse({
    id: job.id,
    agentId: job.publicAgentId,
    symbol: job.symbol,
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt === null ? null : new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(),
    result: job.result,
    error,
  });
}
export function adviceRoutes(services: AdviceRouteServices) {
  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  api.use("*", authenticated(services.authenticate, { userOnly: true }));

  api.use(
    "*",
    bodyLimit({
      maxSize: 8192,
      onError: () => {
        throw new HttpError(413, "Analysis request exceeds its limit", { error: "INVALID_INPUT" });
      },
    }),
  );
  api.onError((error) => {
    if (error instanceof PilotError && notForSale(error)) {
      throw new HttpError(404, "Agent analyses are not for sale", {
        error: "ADVICE_NOT_FOR_SALE",
      });
    }
    if (error instanceof PilotError) {
      const statuses = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        INVALID_INPUT: 400,
        MARKET_NOT_ALLOWED: 400,
        CONFLICT: 409,
        ADVICE_BUSY: 429,
        ADVICE_UNAVAILABLE: 503,
        ADVICE_COST_UNKNOWN: 503,
        ADVICE_BUDGET_EXCEEDED: 429,
      } as const;
      const status = statuses[error.code as keyof typeof statuses] ?? 500;
      throw new HttpError(status, "Analysis request could not be processed", {
        error: error.code in statuses ? error.code : "ANALYSIS_FAILED",
      });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new HttpError(400, "Invalid analysis request", { error: "INVALID_INPUT" });
    }
    throw error;
  });
  const describe = (
    id: string,
    response: z.ZodType,
    extra: Partial<Parameters<typeof operation>[1]> = {},
  ) =>
    operation(id, {
      response: dto.envelopeSchema(response),
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 429, 500, 503],
      ...extra,
    });
  api.get(
    "/agents/:agentId/capabilities",
    describe("adviceCapabilities", dto.adviceCapabilitiesSchema),
    async (c) => {
      const id = z.string().uuid().parse(c.req.param("agentId"));
      const result = await services.service.capabilities(c.get("principal"), id);
      return c.json(successEnvelope(dto.adviceCapabilitiesSchema.parse(result), c.req.path));
    },
  );
  const accepted = async (c: Context<AppEnv>, job: AdviceJob) => {
    if (job.status === "queued") {
      try {
        await services.notify();
      } catch {
        console.error("Advice wakeup awaits scheduled reconciliation");
      }
    }
    const response = dto.adviceAcceptedSchema.parse({
      id: job.id,
      status: job.status,
      statusUrl: `/v1/agent-advice/recommendations/${job.id}`,
    });
    return c.json(successEnvelope(response, c.req.path, "Analysis accepted", 202), 202);
  };
  api.post(
    "/agents/:agentId/recommendations",
    describe("adviceRequest", dto.adviceAcceptedSchema, {
      body: dto.adviceRequestSchema,
      status: 202,
      idempotent: true,
      description:
        "Request fresh BTC/ETH 24-hour analysis. Exact key/content replay returns the original job; changed symbol returns 409. JWT does not prove payment or exclusive mobile origin. When the deployment sells analyses with x402 (ADVICE_X402_ENABLED), a request without X-PAYMENT answers 402 with the x402 v1 payment requirements after the admission checks (503 and 404 come first); a valid X-PAYMENT is settled on chain before the job is enqueued, and the 202 carries X-PAYMENT-RESPONSE. A replay of the same Idempotency-Key never charges again. An agent with no price answers 404 ADVICE_NOT_FOR_SALE; another attempt in flight for the same key answers 409.",
      headers: {
        "X-PAYMENT": {
          description:
            "x402 v1: base64 JSON { x402Version: 1, scheme: exact, network: monad-testnet, payload: { signature, authorization } } with an EIP-3009 TransferWithAuthorization for AUSD signed by a wallet linked to the caller. Only read when x402 is on.",
        },
      },
      responseHeaders: {
        "X-PAYMENT-RESPONSE": {
          description:
            "Only on a request this call settled: base64 JSON { success: true, transaction, network: monad-testnet, payer }. Absent on replays and when x402 is off.",
          schema: { type: "string" },
        },
      },
      responses: {
        402: {
          description:
            "x402 v1 payment required (not the response envelope). error is the header requirement or one of the payment refusals; accepts holds the one set of terms to sign.",
          schema: dto.paymentRequiredSchema,
        },
      },
    }),
    async (c) => {
      const id = z.string().uuid().parse(c.req.param("agentId"));
      const body = dto.adviceRequestSchema.parse(await c.req.json());
      const key = dto.idempotencyKeySchema.parse(c.req.header("Idempotency-Key"));
      if (!services.paid) {
        const job = await services.service.request(c.get("principal"), id, body.symbol, key);
        return accepted(c, job);
      }
      const result = await services.paid.request(
        c.get("principal"),
        id,
        body.symbol,
        key,
        c.req.header("X-PAYMENT"),
      );
      if (result.kind === "payment_required") {
        const refusal = dto.paymentRequiredSchema.parse({
          x402Version: 1,
          error: result.error ?? PAYMENT_HEADER_REQUIRED,
          accepts: [result.requirements],
        });
        return c.json(refusal, 402);
      }
      if (result.settlement) {
        c.header("X-PAYMENT-RESPONSE", result.settlement);
      }
      return accepted(c, result.job);
    },
  );
  api.get(
    "/recommendations/:id",
    describe("adviceGet", dto.adviceRecommendationSchema, {
      description:
        "Pending/failed jobs are requester-only; completed analysis is shared with authenticated users. Private provider, configuration and cost records are excluded.",
    }),
    async (c) => {
      const id = z.string().uuid().parse(c.req.param("id"));
      return c.json(
        successEnvelope(publicJob(await services.service.get(c.get("principal"), id)), c.req.path),
      );
    },
  );
  api.get(
    "/agents/:agentId/recommendations",
    describe("adviceHistory", dto.adviceHistorySchema, {
      description:
        "Free authenticated completed history, newest first, 20 items per page. This read never starts an analysis or provider call.",
      query: {
        symbol: { schema: { type: "string", enum: ["BTC", "ETH"] } },
        cursor: { schema: { type: "string", maxLength: 100 } },
      },
    }),
    async (c) => {
      const id = z.string().uuid().parse(c.req.param("agentId"));
      const symbol = dto.adviceSymbolSchema.optional().parse(c.req.query("symbol"));
      const cursor = z.string().max(100).optional().parse(c.req.query("cursor"));
      const page = await services.service.history(c.get("principal"), id, symbol, cursor);
      return c.json(
        successEnvelope(
          dto.adviceHistorySchema.parse({
            items: page.items.map(publicJob),
            nextCursor: page.nextCursor,
          }),
          c.req.path,
        ),
      );
    },
  );
  return api;
}

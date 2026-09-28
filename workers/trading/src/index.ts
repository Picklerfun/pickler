import { createTradingService } from "@pickler/trading/polymarket";
import { PilotError } from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresTradingStore,
  PolymarketTrading,
} from "@pickler/infrastructure";
import { liveBuySchema, liveOrderSchema, idempotencyKeySchema } from "@pickler/api-schema";
import { z } from "zod";

export interface Env {
  APP_ENV: string;
  DATABASE?: Hyperdrive;
  DATABASE_URL?: string;
  TRADING_ADMISSIONS_ENABLED: string;
  TRADING_QUEUE: Queue<{ kind: "trading-wakeup" }>;
  POLYMARKET_SIGNER_PRIVATE_KEY?: string;
  POLYMARKET_SIGNER_ADDRESS?: string;
  POLYMARKET_WALLET_ADDRESS?: string;
  POLYMARKET_CLOB_API_KEY?: string;
  POLYMARKET_CLOB_API_SECRET?: string;
  POLYMARKET_CLOB_API_PASSPHRASE?: string;
}
function compose(env: Env) {
  const credentials = {
    privateKey: env.POLYMARKET_SIGNER_PRIVATE_KEY,
    signer: env.POLYMARKET_SIGNER_ADDRESS,
    wallet: env.POLYMARKET_WALLET_ADDRESS,
    apiKey: env.POLYMARKET_CLOB_API_KEY,
    secret: env.POLYMARKET_CLOB_API_SECRET,
    passphrase: env.POLYMARKET_CLOB_API_PASSPHRASE,
  };
  const parsed = z
    .object({
      privateKey: z.string().min(1),
      signer: z.string().min(1),
      wallet: z.string().min(1),
      apiKey: z.string().min(1),
      secret: z.string().min(1),
      passphrase: z.string().min(1),
    })
    .safeParse(credentials);
  if (!parsed.success) {
    throw new PilotError("TRADING_NOT_CONFIGURED", "Trading credentials unavailable");
  }
  if (!env.DATABASE && env.APP_ENV !== "local") {
    throw new Error("Trading database binding unavailable");
  }
  const provider = new PolymarketTrading(parsed.data);
  const owner = new PostgresResearchStore(
    env.DATABASE?.connectionString ?? env.DATABASE_URL!,
    undefined,
    env.DATABASE ? { environment: env.APP_ENV, transport: "hyperdrive" } : { environment: "local" },
  );
  const repository = new PostgresTradingStore(
    owner.pool,
    undefined,
    parsed.data.wallet.toLowerCase(),
  );
  return { service: createTradingService(repository, provider), close: () => owner.close() };
}
const scopeSchema = z.object({ tenantId: z.string().min(1), agentId: z.string().min(1) }).strict();
const inputSchema = z
  .object({
    scope: scopeSchema,
    key: idempotencyKeySchema.optional(),
    request: liveBuySchema.optional(),
    runId: z.string().optional(),
  })
  .strict();
export function createTradingWorker(
  runtime: typeof compose = compose,
): ExportedHandler<Env, { kind: "trading-wakeup" }> {
  return {
    async fetch(request, env) {
      if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      if (env.TRADING_ADMISSIONS_ENABLED !== "true" && new URL(request.url).pathname !== "/check") {
        return Response.json({ error: "TRADING_ADMISSIONS_PAUSED" }, { status: 409 });
      }
      let instance: ReturnType<typeof compose> | undefined;
      try {
        if (Number(request.headers.get("content-length") ?? 0) > 16384) {
          return new Response(null, { status: 413 });
        }
        const raw = await request.text();
        if (raw.length > 16384) {
          return new Response(null, { status: 413 });
        }
        const input = inputSchema.parse(JSON.parse(raw));
        instance = runtime(env);
        const path = new URL(request.url).pathname;
        if (path === "/check") {
          return Response.json(await instance.service.check(input.scope));
        }
        const key = idempotencyKeySchema.parse(input.key);
        const result =
          path === "/prepare"
            ? await instance.service.prepare(input.scope, liveBuySchema.parse(input.request), key)
            : path === "/from-run" && input.runId
              ? await instance.service.fromRun(input.scope.tenantId, input.runId, key)
              : null;
        if (!result) {
          return new Response(null, { status: 404 });
        }
        if (result.status === "queued") {
          try {
            await env.TRADING_QUEUE.send({ kind: "trading-wakeup" });
          } catch {
            console.error("Trading notification awaits reconciliation");
          }
        }
        return Response.json(liveOrderSchema.parse(result));
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof PilotError
                ? error.code
                : error instanceof z.ZodError || error instanceof SyntaxError
                  ? "INVALID_INPUT"
                  : "TRADING_PROVIDER_FAILURE",
          },
          { status: 409 },
        );
      } finally {
        await instance?.close();
      }
    },
    async queue(batch, env) {
      for (const message of batch.messages) {
        if (message.body?.kind !== "trading-wakeup") {
          message.ack();
          continue;
        }
        let instance: ReturnType<typeof compose> | undefined;
        try {
          instance = runtime(env);
          await instance.service.tick(env.TRADING_ADMISSIONS_ENABLED === "true");
          message.ack();
        } catch {
          message.retry({ delaySeconds: 30 });
        } finally {
          await instance?.close();
        }
      }
    },
    async scheduled(_event, env) {
      await env.TRADING_QUEUE.send({ kind: "trading-wakeup" });
    },
  };
}
export default createTradingWorker();

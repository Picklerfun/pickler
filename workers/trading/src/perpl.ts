import {
  PostgresResearchStore,
  createSupabaseJwtVerifier,
  createTurnkeyActivityForwarder,
  createTurnkeyReader,
} from "@pickler/infrastructure";
import {
  PostgresPerplLiveStore,
  createPerplLiveDriver,
  perplLivePolicySchema,
} from "@pickler/infrastructure/perpl-live";
import { createPerplLiveService } from "@pickler/trading/perpl-live";
import { PilotError, InvalidAccessTokenError } from "@pickler/core";
import * as dto from "@pickler/api-schema";
import { z } from "zod";
import type { Env } from "./index";
import { perplSetupDto, perplStateDto } from "./perpl-dto";

const scopeSchema = z
  .object({ userId: z.string().uuid(), productAgentId: z.string().uuid() })
  .strict();
const commandSchema = z
  .object({
    scope: scopeSchema,
    key: dto.idempotencyKeySchema.optional(),
    input: z.unknown().optional(),
  })
  .strict();
const atomic = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
};
export function composePerplTrading(env: Env) {
  if (!env.DATABASE && env.APP_ENV !== "local") {
    throw new PilotError("PERPL_UNAVAILABLE", "Trading database binding unavailable");
  }
  const owner = new PostgresResearchStore(
    env.DATABASE?.connectionString ?? env.DATABASE_URL!,
    undefined,
    env.DATABASE ? { environment: env.APP_ENV, transport: "hyperdrive" } : { environment: "local" },
  );
  const repository = new PostgresPerplLiveStore(owner.pool);
  let driver: ReturnType<typeof createPerplLiveDriver> | undefined;
  try {
    if (env.PERPL_LIVE_POLICY_JSON && env.PERPL_KEY_ENCRYPTION_KEY) {
      const policy = perplLivePolicySchema.parse(JSON.parse(env.PERPL_LIVE_POLICY_JSON));
      const reader =
        env.TURNKEY_API_PUBLIC_KEY && env.TURNKEY_API_PRIVATE_KEY
          ? createTurnkeyReader({
              apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
              apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
            })
          : undefined;
      const forwarder = reader ? createTurnkeyActivityForwarder({ reader }) : undefined;
      driver = createPerplLiveDriver({
        policy,
        encryptionKey: env.PERPL_KEY_ENCRYPTION_KEY,
        ...(forwarder && reader ? { forwarder, reader } : {}),
      });
    }
  } catch {
    console.error("Perpl trading configuration unavailable");
  }
  return {
    repository,
    service: driver
      ? createPerplLiveService({
          repository,
          driver,
          admissions: env.PERPL_ADMISSIONS_ENABLED === "true",
          setupAdmissions: env.PERPL_ACCOUNT_SETUP_ENABLED === "true",
          randomId: () => crypto.randomUUID(),
        })
      : null,
    close: () => owner.close(),
  };
}
/** Direct requests and Service Binding requests both require the original user's verified JWT. */
export async function verifyPerplUser(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ") || !env.JWT_ISSUER) {
    throw new InvalidAccessTokenError();
  }
  const verified = await createSupabaseJwtVerifier({
    issuer: env.JWT_ISSUER,
    jwksUrl: `${env.JWT_ISSUER}/.well-known/jwks.json`,
    audience: env.JWT_AUDIENCE ?? "authenticated",
  }).verify(header.slice(7));
  return z.string().uuid().parse(verified.userId);
}
export async function perplTradingRequest(
  request: Request,
  env: Env,
  runtime = composePerplTrading,
  verify = verifyPerplUser,
) {
  let instance: ReturnType<typeof composePerplTrading> | undefined;
  try {
    // Authentication precedes parsing and all database/provider composition. The repository then
    // rechecks persisted workspace ownership and creator permissions inside every mutation.
    const userId = await verify(request, env);
    if (request.method !== "POST" || Number(request.headers.get("content-length") ?? 0) > 32768) {
      return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    const raw = await request.text();
    if (raw.length > 32768) {
      return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    const body = commandSchema.parse(JSON.parse(raw));
    if (body.scope.userId !== userId) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    instance = runtime(env);
    const path = new URL(request.url).pathname;
    if (path === "/perpl/state") {
      const state = instance.service
        ? await instance.service.state(body.scope)
        : {
            ...(await instance.repository.read(body.scope)),
            available: false,
            admissionsEnabled: false,
          };
      return Response.json(perplStateDto(state));
    }
    if (!instance.service) {
      throw new PilotError("PERPL_UNAVAILABLE", "Perpl execution has not been configured");
    }
    if (path === "/perpl/credentials/connect") {
      const input = dto.perplLiveExistingKeySchema.parse(body.input);
      const connected = await instance.service.connectExistingKey(body.scope, {
        ...input,
        useKeyWallet: input.useKeyWallet ?? false,
      });
      return Response.json(perplStateDto(connected));
    }
    if (path === "/perpl/setup/prepare") {
      const input = dto.perplLiveSetupRequestSchema.parse(body.input);
      const setup = await instance.service.prepareSetup(
        body.scope,
        atomic(input.collateralAusd),
        dto.idempotencyKeySchema.parse(body.key),
      );
      return Response.json(perplSetupDto(setup));
    }
    if (path === "/perpl/setup/confirm") {
      const input = dto.perplLiveConfirmSchema.parse(body.input);
      const setup = await instance.service.confirmSetup(body.scope, input.setupId, input.signed);
      try {
        await env.TRADING_QUEUE.send({ kind: "trading-wakeup" });
      } catch {
        console.error("Perpl setup awaits Cron reconciliation");
      }
      return Response.json(perplSetupDto(setup));
    }
    if (path === "/perpl/start") {
      const input = dto.perplLiveStartSchema.parse(body.input);
      await instance.service.start(
        body.scope,
        {
          symbol: input.symbol,
          marginMicros: atomic(input.marginAusd),
          leverage: input.leverage,
          cycles: input.cycles,
          holdSeconds: input.holdSeconds,
        },
        dto.idempotencyKeySchema.parse(body.key),
      );
    } else if (path === "/perpl/control") {
      await instance.service.control(
        body.scope,
        dto.perplLiveControlSchema.parse(body.input).action,
      );
    } else {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    try {
      await env.TRADING_QUEUE.send({ kind: "trading-wakeup" });
    } catch {
      console.error("Perpl notification awaits Cron reconciliation");
    }
    return Response.json(perplStateDto(await instance.service.state(body.scope)), { status: 202 });
  } catch (error) {
    const code =
      error instanceof InvalidAccessTokenError
        ? "UNAUTHORIZED"
        : error instanceof PilotError
          ? error.code
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? "INVALID_INPUT"
            : "PERPL_UNAVAILABLE";
    const status =
      code === "UNAUTHORIZED"
        ? 401
        : code === "INVALID_INPUT"
          ? 400
          : code === "NOT_FOUND"
            ? 404
            : code === "PERPL_UNAVAILABLE"
              ? 503
              : 409;
    return Response.json(
      { error: code, ...(error instanceof PilotError ? { message: error.message } : {}) },
      { status },
    );
  } finally {
    await instance?.close();
  }
}
export async function tickPerplTrading(env: Env, runtime = composePerplTrading) {
  const instance = runtime(env);
  try {
    return (await instance.service?.tickDue()) ?? false;
  } finally {
    await instance.close();
  }
}

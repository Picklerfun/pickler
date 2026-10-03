import * as dto from "@pickler/api-schema";
import { z } from "zod";
import { operation } from "../openapi/operation";
import { Hono } from "hono";

import { LAUNCH_LIST_LIMITS, type LaunchErrorDto } from "@pickler/api-schema";
import type { PostgresLaunchReadModel } from "@pickler/infrastructure";

import type { AppEnv } from "../env";

/**
 * Public reads over the launch catalogue.
 *
 * Every response carries the freshness the read model reports, unchanged. The API does not
 * decide whether an answer is current: it knows only what the indexer reached, and hiding
 * that would leave a client unable to tell a live price from one that stopped being true.
 *
 * Nothing here signs, quotes or prepares a transaction. Those need chain reads and belong
 * with the routes that can refuse rather than estimate when a node is unreachable.
 */
export function launchRoutes(readModel: PostgresLaunchReadModel) {
  const api = new Hono<AppEnv>();

  api.get(
    "/",
    operation("launchesList", {
      errors: z.union([dto.launchErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 404, 500, 503],
      response: dto.launchesReadSchema,
      query: {
        chainId: {},
        phase: {},
        limit: { schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        cursor: {},
      },
    }),
    async (c) => {
      const limit = parseLimit(c.req.query("limit"));
      if (limit instanceof Response) {
        return limit;
      }

      const result = await readModel.listLaunches({
        chain: c.req.query("chainId"),
        phase: c.req.query("phase"),
        limit,
        cursor: c.req.query("cursor"),
      });

      return c.json(result);
    },
  );

  api.get(
    "/:id",
    operation("launchesGet", {
      errors: z.union([dto.launchErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 404, 500, 503],
      response: dto.freshnessReadSchema(dto.launchDetailSchema),
    }),
    async (c) => {
      const result = await readModel.getLaunch(c.req.param("id"));

      if (result === null) {
        return notFound(c);
      }

      return c.json(result);
    },
  );

  api.get(
    "/:id/trades",
    operation("launchesTrades", {
      errors: z.union([dto.launchErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 404, 500, 503],
      response: dto.freshnessReadSchema(dto.launchTradeSchema.array()),
      query: {
        limit: { schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        cursor: {},
      },
    }),
    async (c) => {
      const limit = parseLimit(c.req.query("limit"));
      if (limit instanceof Response) {
        return limit;
      }

      const result = await readModel.listTrades(c.req.param("id"), {
        limit,
        cursor: c.req.query("cursor"),
      });

      if (result === null) {
        return notFound(c);
      }

      return c.json(result);
    },
  );

  return api;
}

/** A limit past the ceiling is refused, not silently clamped: the caller asked for something
 * they will not get, and answering with less without saying so is how a client concludes a
 * list ended when it did not. */
function parseLimit(raw: string | undefined): number | undefined | Response {
  if (raw === undefined) {
    return undefined;
  }

  const limit = Number(raw);

  if (!Number.isInteger(limit) || limit < 1 || limit > LAUNCH_LIST_LIMITS.maxLimit) {
    const body: LaunchErrorDto = {
      error: {
        code: "invalid_request",
        message: `limit must be an integer between 1 and ${LAUNCH_LIST_LIMITS.maxLimit}`,
        retryable: false,
      },
    };

    return Response.json(body, { status: 400 });
  }

  return limit;
}

function notFound(c: { json: (body: unknown, status: 404) => Response }): Response {
  const body: LaunchErrorDto = {
    error: { code: "launch_not_found", message: "No such launch", retryable: false },
  };

  return c.json(body, 404);
}

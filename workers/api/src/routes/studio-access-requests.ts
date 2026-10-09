import { Hono } from "hono";
import { createStudioAccessRequests, type StudioAccessRequestRepository } from "@pickler/core";
import * as dto from "@pickler/api-schema";
import type { AppEnv } from "../env";
import { operation } from "../openapi/operation";

/**
 * Creator access, read only. The request that used to be posted here was retired with the public
 * application (docs/specs/landing-trade-v1.md §7): the way in is /create, reviewed through
 * studio-applications.ts. What stays is a person's own status and the operators' view of the
 * requests recorded before that.
 */
export function studioAccessRequestRoutes(repository?: StudioAccessRequestRepository) {
  const app = new Hono<AppEnv>();
  const service = repository ? createStudioAccessRequests(repository) : null;
  const errors = {
    security: "user" as const,
    errors: dto.studioErrorSchema,
    errorStatuses: [400, 401, 403, 503],
  };
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.get(
    "/access-request",
    operation("studioAccessRequestStatus", {
      ...errors,
      description: "Own creator-access request status. User JWT required; no access is granted.",
      response: dto.studioAccessRequestStatusSchema,
    }),
    async (c) => {
      if (!service) {
        return c.json({ error: "ACCESS_REQUEST_UNAVAILABLE" }, 503);
      }
      const state = await service.read(c.get("principal"));
      return c.json({ ...state, requestedAt: state.requestedAt?.toISOString() ?? null });
    },
  );
  app.get(
    "/access-requests",
    operation("studioAccessRequestsInbox", {
      ...errors,
      description:
        "Pending team inbox, oldest first, at most 100. Requires verified user JWT and server-controlled SUPER_ADMIN_EMAILS membership. Ordinary users cannot read other requests.",
      response: dto.studioAccessRequestsInboxSchema,
    }),
    async (c) => {
      if (!service) {
        return c.json({ error: "ACCESS_REQUEST_UNAVAILABLE" }, 503);
      }
      const entries = await service.pending(c.get("principal"));
      return c.json({
        requests: entries.map((r) => ({ ...r, requestedAt: r.requestedAt.toISOString() })),
      });
    },
  );
  return app;
}

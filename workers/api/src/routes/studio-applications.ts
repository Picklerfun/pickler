import { Hono } from "hono";
import { z } from "zod";
import {
  ApplicationNotFoundError,
  createApplicationReview,
  ReviewValidationError,
  type ApplicationReviewEntry,
  type ApplicationReviewRepository,
} from "@pickler/core";
import * as dto from "@pickler/api-schema";
import type { AppEnv } from "../env";
import { operation } from "../openapi/operation";

const toDto = (entry: ApplicationReviewEntry): dto.StudioApplicationDto => ({
  ...entry,
  submittedAt: entry.submittedAt.toISOString(),
  reviewedAt: entry.reviewedAt?.toISOString() ?? null,
  invitedAt: entry.invitedAt?.toISOString() ?? null,
});

/**
 * The operators' inbox for creator applications (docs/specs/landing-trade-v1.md §7): list what
 * /create received, decide invited or rejected. Every call needs a verified user JWT whose email is
 * on the server's SUPER_ADMIN_EMAILS allowlist; everyone else gets 403 and never sees another
 * person's answers. Inviting enables studio access for the application's email; no email is
 * sent from here.
 */
export function studioApplicationRoutes(repository?: ApplicationReviewRepository) {
  const app = new Hono<AppEnv>();
  const service = repository ? createApplicationReview(repository) : null;
  const errors = {
    security: "user" as const,
    errors: dto.studioErrorSchema,
    errorStatuses: [400, 401, 403, 404, 503],
  };
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.get(
    "/applications",
    operation("studioApplicationsInbox", {
      ...errors,
      description:
        "Creator applications, newest first, at most 500, optionally one status. Requires verified user JWT and server-controlled SUPER_ADMIN_EMAILS membership.",
      query: { status: { required: false } },
      response: dto.studioApplicationsSchema,
    }),
    async (c) => {
      if (!service) {
        return c.json({ error: "APPLICATIONS_UNAVAILABLE" }, 503);
      }
      const status = c.req.query("status");
      const parsed = dto.studioApplicationStatusSchema.optional().safeParse(status || undefined);
      if (!parsed.success) {
        return c.json({ error: "BAD_REQUEST", message: "Unknown status" }, 400);
      }
      const entries = await service.list(c.get("principal"), { status: parsed.data ?? null });
      return c.json({ applications: entries.map(toDto) });
    },
  );
  app.put(
    "/applications/:id",
    operation("studioApplicationReview", {
      ...errors,
      description:
        "Records an operator's decision on one application: invited or rejected, with an optional note. Same membership requirement. Inviting enables studio access for the application's email, including accounts created later. Sends no email.",
      body: dto.studioApplicationReviewRequestSchema,
      response: dto.studioApplicationSchema,
    }),
    async (c) => {
      if (!service) {
        return c.json({ error: "APPLICATIONS_UNAVAILABLE" }, 503);
      }
      const id = z.coerce.number().int().positive().safeParse(c.req.param("id"));
      const body = dto.studioApplicationReviewRequestSchema.safeParse(await c.req.json());
      if (!id.success || !body.success) {
        return c.json({ error: "BAD_REQUEST", message: "Invalid review" }, 400);
      }
      try {
        const entry = await service.review(
          c.get("principal"),
          id.data,
          body.data.status,
          body.data.note ?? null,
        );
        return c.json(toDto(entry));
      } catch (error) {
        if (error instanceof ApplicationNotFoundError) {
          return c.json({ error: "NOT_FOUND", message: "No such application" }, 404);
        }
        if (error instanceof ReviewValidationError) {
          return c.json({ error: "BAD_REQUEST", message: error.message }, 400);
        }
        throw error;
      }
    },
  );
  return app;
}

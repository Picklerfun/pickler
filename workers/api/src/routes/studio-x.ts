import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { XFailure, PilotError, AccessDeniedError, createStudioAccess } from "@pickler/core";
import * as dto from "@pickler/api-schema";
import { operation } from "../openapi/operation";
import type { AppEnv } from "../env";
import type { StudioServices } from "./studio";

const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const cookieName = (state: string) => `pk_x_${state}`;
const cookiePath = "/api/v1/studio/x/callback";
function service(services: StudioServices) {
  if (!services.x) {
    throw new XFailure("X_UNAVAILABLE");
  }
  return services.x;
}
export function studioXRoutes(services: StudioServices) {
  const api = new Hono<AppEnv>();
  const errors = [400, 401, 403, 404, 409, 429, 500, 503];
  const access = createStudioAccess(services.directory);
  api.onError((error, c) => {
    if (error instanceof XFailure) {
      if (error.retryAfter !== null) {
        c.header("Retry-After", String(error.retryAfter));
      }
      const status =
        error.code === "X_RATE_LIMITED" ? 429 : error.code === "X_RECONNECT_REQUIRED" ? 409 : 503;
      return c.json(
        {
          error: error.code,
          message:
            error.code === "X_RECONNECT_REQUIRED"
              ? "Reconnect X to continue"
              : error.code === "X_RATE_LIMITED"
                ? "X request limit reached. View posts on X instead; respect Retry-After."
                : "X is unavailable; try again later",
        },
        status,
      );
    }
    throw error;
  });
  api.get(
    "/agents/:id/x",
    operation("studioX", {
      description:
        "Returns stored X connection state and optional profile name/photo. Reading this state makes no X API request; earlier connections may have no photo.",
      security: "user",
      response: dto.xStateResponseSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
    }),
    async (c) => {
      const current = await access.authorize(c.get("principal"));
      if (current.ownerUserId !== c.get("principal").id) {
        throw new AccessDeniedError("Agent owner required");
      }
      await services.directory.agentScope(current, c.req.param("id"));
      if (!services.x) {
        return c.json(
          dto.xStateResponseSchema.parse({
            status: "disconnected",
            account: null,
            available: false,
            readsAvailable: false,
          }),
        );
      }
      return c.json(
        dto.xStateResponseSchema.parse(
          await services.x.state(c.get("principal").id, current.workspaceId, c.req.param("id")),
        ),
      );
    },
  );
  api.post(
    "/agents/:id/x/authorize",
    operation("studioXAuthorize", {
      security: "user",
      body: dto.xAuthorizeRequestSchema,
      response: dto.xAuthorizeResponseSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Owner JWT starts OAuth PKCE and sets a ten-minute HttpOnly browser-binding cookie for the canonical callback.",
      responseHeaders: {
        "Set-Cookie": {
          description:
            "pk_x_<state> browser binding; HttpOnly, SameSite=Lax, Path=/api/v1/studio/x/callback, Max-Age=600; Secure on hosted environments.",
          schema: { type: "string" },
        },
      },
    }),
    async (c) => {
      const current = await access.authorize(c.get("principal"), true);
      const body = dto.xAuthorizeRequestSchema.parse(await c.req.json());
      const result = await service(services).begin(
        c.get("principal").id,
        current.workspaceId,
        c.req.param("id"),
        body.returnTo,
      );
      setCookie(c, cookieName(result.state), result.browser, {
        path: cookiePath,
        httpOnly: true,
        sameSite: "Lax",
        secure: c.env?.APP_ENV !== "local",
        maxAge: 600,
      });
      return c.json(dto.xAuthorizeResponseSchema.parse(result));
    },
  );
  api.delete(
    "/agents/:id/x",
    operation("studioXDisconnect", {
      security: "user",
      response: dto.xDisconnectResponseSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
    }),
    async (c) => {
      const current = await access.authorize(c.get("principal"));
      if (current.ownerUserId !== c.get("principal").id) {
        throw new AccessDeniedError("Agent owner required");
      }
      return c.json(
        dto.xDisconnectResponseSchema.parse(
          await service(services).disconnect(
            c.get("principal").id,
            current.workspaceId,
            c.req.param("id"),
          ),
        ),
      );
    },
  );
  api.get(
    "/agents/:id/x/posts",
    operation("studioXPosts", {
      security: "user",
      response: dto.xPostsResponseSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      query: { cursor: { schema: { type: "string", maxLength: 512 } } },
      description:
        "Explicit paid owner-only preview of at most five original posts including replies, limited to one attempt per agent per UTC day. Reserves quota before token renewal or X transport. Pagination is disabled; cursor is rejected. No polling or content persistence.",
    }),
    async (c) => {
      const current = await access.authorize(c.get("principal"), true);
      const cursor = z.string().min(1).max(512).optional().parse(c.req.query("cursor"));
      return c.json(
        dto.xPostsResponseSchema.parse(
          await service(services).posts(
            c.get("principal").id,
            current.workspaceId,
            c.req.param("id"),
            cursor,
          ),
        ),
      );
    },
  );
  return api;
}

/** X's redirect has no Supabase bearer. This router is mounted before JWT-only Studio. */
export function studioXCallbackRoutes(services: StudioServices) {
  const api = new Hono<AppEnv>();
  api.get(
    "/callback",
    operation("studioXCallback", {
      response: z.null(),
      status: 303,
      redirect: true,
      security: "public",
      errorStatuses: [],
      description:
        "OAuth return only: requires matching single-use state, PKCE attempt and HttpOnly browser cookie. Redirects to a fixed same-origin Studio page with a sanitized outcome; never returns tokens.",
      responseHeaders: {
        "Set-Cookie": {
          description: "Expires the state-specific browser-binding cookie.",
          schema: { type: "string" },
        },
      },
      query: {
        state: { required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } },
        code: { schema: { type: "string", maxLength: 2048 } },
        error: {},
      },
    }),
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      c.header("Referrer-Policy", "no-referrer");
      let target = "/?xResult=failed";
      const state = stateSchema.safeParse(c.req.query("state"));
      if (state.success) {
        target += `&xFlow=${state.data}`;
        const name = cookieName(state.data);
        const browser = getCookie(c, name);
        deleteCookie(c, name, {
          path: cookiePath,
          secure: c.env?.APP_ENV !== "local",
          httpOnly: true,
          sameSite: "Lax",
        });
        if (browser) {
          try {
            const result = await service(services).callback(
              state.data,
              browser,
              z
                .string()
                .max(2048)
                .nullable()
                .parse(c.req.query("code") ?? null),
              Boolean(c.req.query("error")),
            );
            target = `${result.returnTo}&xResult=${result.result}&xFlow=${state.data}`;
          } catch (error) {
            if (
              error instanceof PilotError &&
              ["X_ACCOUNT_MISMATCH", "X_REVOCATION_PENDING"].includes(error.code)
            ) {
              target = `/?xResult=${error.code.toLowerCase()}`;
            }
          }
        }
      }
      return c.redirect(target, 303);
    },
  );
  return api;
}

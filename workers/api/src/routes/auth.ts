// Ported from Relayer core/auth/auth-profile.controller.ts GET /auth/me (commit bb6bb1226e92).
// Behaviour change: returns the caller's identity. Relayer resolved the workspace owner's id,
// so members saw the owner as "me".

import { Hono } from "hono";
import type { AppEnv } from "../env";
import { successEnvelope } from "../http/envelope";
import { authenticated, type Authenticate } from "../middleware/auth";

export function authRoutes(authenticate: Authenticate) {
  return new Hono<AppEnv>().get("/me", authenticated(authenticate, { userOnly: true }), (c) => {
    const principal = c.get("principal");
    const workspace = c.get("workspace");
    if (principal.kind !== "user") {
      throw new Error("userOnly authentication returned a non-user principal");
    }
    return c.json(
      successEnvelope(
        {
          user: { id: principal.id, email: principal.email ?? null },
          workspace: workspace && {
            id: workspace.id,
            name: workspace.name,
            activeModules: workspace.activeModules,
          },
          role: principal.memberRole,
        },
        c.req.path,
        "Profile retrieved",
      ),
    );
  });
}

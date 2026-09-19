// Ported from Relayer core/auth/guards/{combined-auth,module,permission}.guard.ts and the
// @JwtOnly / @RequireModule / @RequirePermission decorators (commit bb6bb1226e92), as Hono
// middleware. Decisions live in @pickler/core; this file only reads HTTP and maps results.

import {
  AccessDeniedError,
  checkPermission,
  hasActiveModule,
  type Actions,
  type Authenticated,
  type AuthenticateOptions,
  type RequestCredentials,
  type Subjects,
} from "@pickler/core";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

export type Authenticate = (
  credentials: RequestCredentials,
  options?: AuthenticateOptions,
) => Promise<Authenticated>;

function credentialsFrom(headers: {
  header(name: string): string | undefined;
}): RequestCredentials {
  const authorization = headers.header("authorization") ?? "";
  const [scheme, value] = authorization.split(" ");
  return {
    bearerToken: scheme === "Bearer" && value ? value : null,
    apiKey: (scheme === "ApiKey" && value ? value : null) ?? headers.header("x-api-key") ?? null,
    selectedWorkspaceId: headers.header("x-integrator-id")?.trim() || null,
    // Cloudflare sets CF-Connecting-IP; it cannot be spoofed by the client behind Cloudflare.
    clientIp: headers.header("cf-connecting-ip") ?? "",
  };
}

/** Bearer JWT or API key. `userOnly` refuses API keys (dashboard and profile routes). */
export function authenticated(authenticate: Authenticate, options: AuthenticateOptions = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { principal, workspace } = await authenticate(credentialsFrom(c.req), options);
    c.set("principal", principal);
    c.set("workspace", workspace);
    await next();
  });
}

/** Passes when ANY required module is active for the workspace (core modules always are). */
export function requireModule(...modules: string[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const workspace = c.get("workspace");
    if (!workspace) {
      throw new AccessDeniedError("No integrator context");
    }
    if (!hasActiveModule(modules, workspace.activeModules)) {
      throw new AccessDeniedError("Module not enabled for this workspace");
    }
    await next();
  });
}

export function requirePermission(action: Actions, subject: Subjects) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const decision = checkPermission(c.get("principal"), { action, subject });
    if (!decision.allowed) {
      throw new AccessDeniedError(decision.reason);
    }
    await next();
  });
}

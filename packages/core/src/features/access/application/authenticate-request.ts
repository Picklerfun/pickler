// Ported from Relayer apps/api/src/core/auth/guards/combined-auth.guard.ts,
// core/auth/workspace-membership.util.ts and api-keys.service.ts#findByKey (commit bb6bb1226e92).
// Behaviour changes:
// - No supabase.auth.getUser() fallback; tokens are verified locally.
// - `integrator_keys.expires_at` is enforced (Relayer only checked api_keys.expires_at).
// - Legacy keys with `encrypted_key` are matched by hash only; the decrypt-and-compare step
//   added nothing once the hash matched.
// - A deactivated workspace is rejected on the API-key path too, not just skipped.
// - A valid token without a workspace authenticates with `workspace: null` (Relayer returned 401),
//   so onboarding routes can create one. Permission checks still deny it ("No integrator context").

import {
  AccessDeniedError,
  AuthenticationRequiredError,
  InactiveWorkspaceError,
} from "../domain/errors.js";
import { isIpAllowed } from "../domain/ip-allowlist.js";
import { buildApiKeyPrincipal, buildUserPrincipal, type Principal } from "../domain/principal.js";
import {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
} from "../ports/access-token-verifier.js";
import type { ApiKeyDirectory } from "../ports/api-key-directory.js";
import type { Workspace, WorkspaceDirectory } from "../ports/workspace-directory.js";

export interface RequestCredentials {
  bearerToken: string | null;
  apiKey: string | null;
  /** X-Integrator-Id: workspace the user wants to act in. */
  selectedWorkspaceId: string | null;
  clientIp: string;
}

export interface AuthenticateOptions {
  /** Dashboard and profile routes require a signed-in user; API keys are refused. */
  userOnly?: boolean;
}

export interface Authenticated {
  principal: Principal;
  /** Null for a signed-in user who has not created or joined a workspace yet. */
  workspace: Workspace | null;
}

export interface AuthenticateDependencies {
  tokens: AccessTokenVerifier;
  workspaces: WorkspaceDirectory;
  apiKeys: ApiKeyDirectory;
  sha256Hex(value: string): Promise<string>;
  now(): Date;
  superAdminEmails: readonly string[];
}

export function createAuthenticateRequest(deps: AuthenticateDependencies) {
  async function viaToken(
    token: string,
    selectedWorkspaceId: string | null,
  ): Promise<Authenticated | null> {
    let user;
    try {
      user = await deps.tokens.verify(token);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        return null;
      }
      throw error;
    }

    let workspace = await deps.workspaces.findOwnedBy(user.userId);
    let role: string | null = workspace ? "admin" : null;

    if (!workspace) {
      const membership = await deps.workspaces.findOldestMembership(user.userId);
      if (membership) {
        workspace = await deps.workspaces.findById(membership.workspaceId);
        role = membership.role;
      }
    }
    // An owner stays admin whichever path resolved the workspace.
    if (workspace && workspace.userId === user.userId) {
      role = "admin";
    }

    if (selectedWorkspaceId) {
      const selectedRole = await deps.workspaces.roleOf(user.userId, selectedWorkspaceId);
      if (!selectedRole) {
        throw new AccessDeniedError("Not a member of the requested workspace");
      }
      const selected = await deps.workspaces.findById(selectedWorkspaceId);
      if (selected) {
        workspace = selected;
        role = selectedRole;
      }
    }

    if (workspace && !workspace.isActive) {
      throw new InactiveWorkspaceError();
    }

    return {
      principal: buildUserPrincipal({
        user: { id: user.userId, email: user.email },
        integrator: workspace,
        memberRole: workspace ? role : null,
        superAdminEmails: deps.superAdminEmails,
      }),
      workspace,
    };
  }

  async function viaApiKey(rawKey: string, clientIp: string): Promise<Authenticated | null> {
    const key = await deps.apiKeys.findByHash(await deps.sha256Hex(rawKey));
    const now = deps.now().getTime();
    if (!key || !key.active || !key.workspaceId) {
      return null;
    }
    if (key.expiresAt && key.expiresAt.getTime() <= now) {
      return null;
    }
    if (key.linkExpiresAt && key.linkExpiresAt.getTime() <= now) {
      return null;
    }
    if (!isIpAllowed(clientIp, key.allowedCidrs)) {
      throw new AccessDeniedError("IP address not in allowlist for this API key");
    }

    const workspace = await deps.workspaces.findById(key.workspaceId);
    if (!workspace) {
      return null;
    }
    if (!workspace.isActive) {
      throw new InactiveWorkspaceError();
    }
    return {
      principal: buildApiKeyPrincipal({ id: key.id, scopes: key.scopes }, workspace.id),
      workspace,
    };
  }

  return async (
    credentials: RequestCredentials,
    options: AuthenticateOptions = {},
  ): Promise<Authenticated> => {
    if (credentials.bearerToken) {
      const result = await viaToken(credentials.bearerToken, credentials.selectedWorkspaceId);
      if (result) {
        return result;
      }
    }
    if (options.userOnly) {
      throw new AuthenticationRequiredError("Bearer JWT required");
    }
    if (credentials.apiKey) {
      const result = await viaApiKey(credentials.apiKey, credentials.clientIp);
      if (result) {
        return result;
      }
    }
    throw new AuthenticationRequiredError();
  };
}

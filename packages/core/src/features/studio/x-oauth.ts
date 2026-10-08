import { AccessDeniedError } from "../access/domain/errors.js";
import { PilotError } from "../research/types.js";
import { createStudioAccess, type StudioAccess, type StudioDirectory } from "./access.js";

export const X_READ_SCOPES = ["users.read", "tweet.read", "offline.access"] as const;
export const X_OAUTH_TTL_MS = 600_000;
export const X_POST_PREVIEW_SIZE = 5;
export const X_POST_REQUESTS_PER_DAY = 1;
export type XConnectionStatus =
  "disconnected" | "connected" | "reconnect_required" | "revocation_pending";
export interface XActor {
  userId: string;
  workspaceId: string;
  tenantId: string;
  agentId: string;
}
export interface XIdentity {
  id: string;
  handle: string;
}
export interface XTokens {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: Date;
}
export interface XGrant extends XActor {
  identity: XIdentity;
  status: Exclude<XConnectionStatus, "disconnected">;
  tokens: XTokens | null;
  version: number;
  verifiedAt: Date;
}
export interface XAttempt extends XActor {
  id: string;
  stateHash: string;
  browserHash: string;
  verifier: string;
  returnTo: string;
  expiresAt: Date;
}
export interface XPosts {
  posts: { id: string; text: string; createdAt: string; url: string }[];
  nextCursor: string | null;
}
export interface XApiPolicy {
  version: number;
  reviewedAt: string;
  identityRequestsPerDay: number;
  postRequestsPerDay: number;
  postResourcesPerDay: number;
}
export class XHandleTakenError extends Error {
  constructor() {
    super("That X account is already connected to another agent");
    this.name = "XHandleTakenError";
  }
}
export class XFailure extends Error {
  constructor(
    public readonly code: "X_UNAVAILABLE" | "X_RECONNECT_REQUIRED" | "X_RATE_LIMITED",
    public readonly retryAfter: number | null = null,
  ) {
    super(code);
  }
}
export interface XOAuthProvider {
  available: boolean;
  readsAvailable: boolean;
  authorize(state: string, challenge: string): string;
  exchange(code: string, verifier: string): Promise<XTokens>;
  refresh(token: string): Promise<XTokens>;
  identity(token: string): Promise<XIdentity>;
  posts(token: string, userId: string, cursor?: string): Promise<XPosts>;
  revoke(token: string): Promise<void>;
}
export interface XOAuthStore {
  pendingRevocations(actor: XActor): Promise<{ id: string; token: string }[]>;
  retainRevocation(actor: XActor, token: string): Promise<string>;
  clearRevocation(actor: XActor, id: string): Promise<void>;
  saveAttempt(attempt: XAttempt): Promise<void>;
  claimAttempt(stateHash: string, browserHash: string, now: Date): Promise<XAttempt>;
  finishAttempt(id: string): Promise<void>;
  grant(actor: XActor): Promise<XGrant | null>;
  legacy(actor: XActor): Promise<{ handle: string; verifiedAt: Date } | null>;
  connect(attempt: XAttempt, identity: XIdentity, tokens: XTokens, now: Date): Promise<void>;
  claimRefresh(actor: XActor, version: number, now: Date): Promise<string>;
  finishRefresh(
    actor: XActor,
    version: number,
    claim: string,
    tokens: XTokens,
    now: Date,
  ): Promise<void>;
  reconnect(actor: XActor, version: number): Promise<void>;
  assertGrant(actor: XActor, version: number): Promise<void>;
  validatePublication(actor: XActor, version: number, now: Date): Promise<void>;
  disconnect(actor: XActor): Promise<XGrant | null>;
  revoked(actor: XActor, version: number): Promise<void>;
  reserveRead(
    actor: XActor,
    kind: "identity" | "posts",
    policy: XApiPolicy,
    now: Date,
  ): Promise<void>;
  rateLimited(actor: XActor, retryAfter: number, now: Date): Promise<void>;
}
export interface XSecrets {
  id(): string;
  random(): string;
  hash(value: string): Promise<string>;
}

export function xReturnTo(raw: string, agentId: string): string {
  if (!raw.startsWith("/") || raw.includes("\\")) {
    throw new PilotError("INVALID_INPUT", "Return to Studio");
  }
  const url = new URL(raw, "https://return.invalid");
  if (
    url.origin !== "https://return.invalid" ||
    !["/", "/studio"].includes(url.pathname) ||
    raw.startsWith("//")
  ) {
    throw new PilotError("INVALID_INPUT", "Return to the Studio page");
  }
  const query = new URLSearchParams({ agent: agentId });
  const section = url.searchParams.get("resume");
  if (
    section &&
    ["overview", "console", "trades", "activity", "brief", "skills", "limits", "identity"].includes(
      section,
    )
  ) {
    query.set("resume", section);
  }
  return `${url.pathname}?${query}`;
}

export function createXOAuthService(deps: {
  directory: StudioDirectory;
  store: XOAuthStore;
  provider: XOAuthProvider;
  secrets: XSecrets;
  policy: XApiPolicy | null;
  now?: () => Date;
}) {
  const { directory, store, provider, secrets } = deps;
  const now = deps.now ?? (() => new Date());
  async function actor(
    userId: string,
    workspaceId: string | null,
    agentId: string,
    creator = true,
  ): Promise<XActor> {
    const access = await createStudioAccess(directory).authorize(
      { kind: "user", id: userId, tenantId: workspaceId } as Parameters<
        ReturnType<typeof createStudioAccess>["authorize"]
      >[0],
      creator,
    );
    if (access.ownerUserId !== userId) {
      throw new AccessDeniedError("Agent owner required");
    }
    await directory.agentScope(access, agentId);
    return { userId, workspaceId: access.workspaceId, tenantId: access.tenantId, agentId };
  }
  async function recheck(value: XActor) {
    const current = await actor(value.userId, value.workspaceId, value.agentId);
    if (current.tenantId !== value.tenantId) {
      throw new AccessDeniedError("Workspace identity changed");
    }
  }
  function enabled() {
    if (!provider.available || !deps.policy) {
      throw new XFailure("X_UNAVAILABLE");
    }
  }
  async function fail(error: unknown, value: XActor, version?: number): Promise<never> {
    if (error instanceof XFailure) {
      if (error.code === "X_RECONNECT_REQUIRED" && version !== undefined) {
        await store.reconnect(value, version);
      }
      if (error.retryAfter !== null) {
        await store.rateLimited(value, error.retryAfter, now());
      }
    }
    throw error;
  }
  async function dispose(value: XActor, tokens: XTokens) {
    for (const token of new Set([tokens.accessToken, tokens.refreshToken])) {
      const id = await store.retainRevocation(value, token);
      try {
        await provider.revoke(token);
        await store.clearRevocation(value, id);
      } catch {
        /* Local authorization remains blocked; an explicit disconnect retries cleanup. */
      }
    }
  }
  async function token(value: XActor): Promise<XGrant & { tokens: XTokens }> {
    enabled();
    await recheck(value);
    let grant = await store.grant(value);
    if (!grant || grant.status !== "connected" || !grant.tokens) {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
    if (grant.tokens.expiresAt.getTime() <= now().getTime() + 30_000) {
      const claim = await store.claimRefresh(value, grant.version, now());
      let refreshed: XTokens | null = null;
      try {
        const tokens = await provider.refresh(grant.tokens.refreshToken);
        refreshed = tokens;
        assertScopes(tokens);
        await recheck(value);
        await store.finishRefresh(value, grant.version, claim, tokens, now());
      } catch (error) {
        await store.reconnect(value, grant.version);
        if (refreshed) {
          await dispose(value, refreshed);
        }
        return fail(error, value);
      }
      grant = await store.grant(value);
    }
    if (!grant || grant.status !== "connected" || !grant.tokens) {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
    return grant as XGrant & { tokens: XTokens };
  }
  function assertScopes(tokens: XTokens) {
    if (!X_READ_SCOPES.every((scope) => tokens.scopes.includes(scope)) || !tokens.refreshToken) {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
  }
  return {
    async state(userId: string, workspaceId: string | null, agentId: string) {
      const value = await actor(userId, workspaceId, agentId, false);
      const grant = await store.grant(value);
      const old = grant ? null : await store.legacy(value);
      const pending = await store.pendingRevocations(value);
      return {
        status:
          grant?.status ??
          (pending.length ? "revocation_pending" : old ? "reconnect_required" : "disconnected"),
        account: grant
          ? { handle: grant.identity.handle, verifiedAt: grant.verifiedAt.toISOString() }
          : old
            ? { handle: old.handle, verifiedAt: old.verifiedAt.toISOString() }
            : null,
        available: provider.available && deps.policy !== null,
        readsAvailable: provider.available && provider.readsAvailable && deps.policy !== null,
      };
    },
    async begin(userId: string, workspaceId: string | null, agentId: string, returnTo: string) {
      const value = await actor(userId, workspaceId, agentId);
      enabled();
      if ((await store.pendingRevocations(value)).length) {
        throw new PilotError("X_REVOCATION_PENDING", "Finish disconnecting before reconnecting");
      }
      const state = secrets.random();
      const browser = secrets.random();
      const verifier = secrets.random();
      const attempt: XAttempt = {
        ...value,
        id: secrets.id(),
        stateHash: await secrets.hash(state),
        browserHash: await secrets.hash(browser),
        verifier,
        returnTo: xReturnTo(returnTo, agentId),
        expiresAt: new Date(now().getTime() + X_OAUTH_TTL_MS),
      };
      await store.saveAttempt(attempt);
      return {
        authorizationUrl: provider.authorize(state, await secrets.hash(verifier)),
        browser,
        state,
      };
    },
    async callback(state: string, browser: string, code: string | null, denied: boolean) {
      enabled();
      const attempt = await store.claimAttempt(
        await secrets.hash(state),
        await secrets.hash(browser),
        now(),
      );
      try {
        await recheck(attempt);
        if (denied || !code) {
          return { returnTo: attempt.returnTo, result: "cancelled" };
        }
        const tokens = await provider.exchange(code, attempt.verifier);
        try {
          assertScopes(tokens);
          await store.reserveRead(attempt, "identity", deps.policy!, now());
          const identity = await provider.identity(tokens.accessToken);
          await recheck(attempt);
          await store.connect(attempt, identity, tokens, now());
          return { returnTo: attempt.returnTo, result: "connected" };
        } catch (error) {
          // Best-effort disposal; the tokens never authorize local reads if linking fails.
          await dispose(attempt, tokens);
          return await fail(error, attempt);
        }
      } catch (error) {
        const result =
          error instanceof PilotError &&
          ["X_ACCOUNT_MISMATCH", "X_REVOCATION_PENDING", "X_HANDLE_TAKEN"].includes(error.code)
            ? error.code.toLowerCase()
            : error instanceof XHandleTakenError
              ? "x_handle_taken"
              : "failed";
        return { returnTo: attempt.returnTo, result };
      } finally {
        await store.finishAttempt(attempt.id);
      }
    },
    async posts(userId: string, workspaceId: string | null, agentId: string, cursor?: string) {
      const value = await actor(userId, workspaceId, agentId);
      if (!provider.readsAvailable) {
        throw new XFailure("X_UNAVAILABLE");
      }
      if (cursor) {
        throw new PilotError("INVALID_INPUT", "Post pagination is disabled. View more on X.");
      }
      enabled();
      const existing = await store.grant(value);
      if (!existing || existing.status !== "connected" || !existing.tokens) {
        throw new XFailure("X_RECONNECT_REQUIRED");
      }
      await store.reserveRead(value, "posts", deps.policy!, now());
      const grant = await token(value);
      try {
        const posts = await provider.posts(grant.tokens.accessToken, grant.identity.id, cursor);
        await recheck(value);
        await store.assertGrant(value, grant.version);
        return posts;
      } catch (error) {
        return fail(error, value, grant.version);
      }
    },
    async validateForPublish(access: StudioAccess, agentId: string) {
      const value = await actor(access.ownerUserId, access.workspaceId, agentId);
      const grant = await token(value);
      await store.reserveRead(value, "identity", deps.policy!, now());
      try {
        const identity = await provider.identity(grant.tokens.accessToken);
        if (identity.id !== grant.identity.id) {
          throw new XFailure("X_RECONNECT_REQUIRED");
        }
        await recheck(value);
        await store.validatePublication(value, grant.version, now());
      } catch (error) {
        return fail(error, value, grant.version);
      }
    },
    async disconnect(userId: string, workspaceId: string | null, agentId: string) {
      const value = await actor(userId, workspaceId, agentId, false);
      const grant = await store.disconnect(value);
      let pending = false;
      for (const item of await store.pendingRevocations(value)) {
        try {
          await provider.revoke(item.token);
          await store.clearRevocation(value, item.id);
        } catch {
          pending = true;
        }
      }
      if (grant?.tokens) {
        try {
          // Disconnect moved each credential into its own pending record atomically.
          // A successful revocation removes only that record, so retries keep no spent token.
          if (!pending && !grant.tokens.accessToken && !grant.tokens.refreshToken) {
            await store.revoked(value, grant.version);
          } else {
            pending = true;
          }
        } catch {
          pending = true;
        }
      } else if (grant) {
        pending = true;
      }
      return {
        disconnected: true as const,
        status: pending ? ("revocation_pending" as const) : ("disconnected" as const),
      };
    },
  };
}
export type XOAuthService = ReturnType<typeof createXOAuthService>;

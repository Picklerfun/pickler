import { z } from "zod";
import {
  XFailure,
  X_READ_SCOPES,
  X_POST_PREVIEW_SIZE,
  type XApiPolicy,
  type XOAuthProvider,
  type XTokens,
} from "@pickler/core";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(86_400),
  scope: z.string(),
  token_type: z.literal("bearer").or(z.literal("Bearer")),
});
const identitySchema = z.object({
  data: z.object({
    id: z.string().regex(/^\d+$/),
    username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  }),
});
const postsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().regex(/^\d+$/),
        author_id: z.string(),
        text: z.string(),
        created_at: z.string().datetime(),
      }),
    )
    .max(X_POST_PREVIEW_SIZE)
    .optional(),
  meta: z.object({ next_token: z.string().max(512).optional() }).optional(),
  errors: z.array(z.unknown()).optional(),
});
const policySchema = z
  .object({
    version: z.number().int().positive(),
    reviewedAt: z.string().datetime(),
    identityRequestsPerDay: z.number().int().positive().max(10_000),
    postRequestsPerDay: z.number().int().positive().max(10_000),
    postResourcesPerDay: z.number().int().min(X_POST_PREVIEW_SIZE).max(200_000),
  })
  .strict();
export function parseXApiPolicy(raw?: string): XApiPolicy | null {
  if (!raw) {
    return null;
  }
  try {
    return policySchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Invalid X_API_POLICY_JSON");
  }
}
export function xSecrets() {
  return {
    id() {
      return crypto.randomUUID();
    },
    random() {
      return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    },
    async hash(value: string) {
      return Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ).toString("base64url");
    },
  };
}
export function createXOAuthProvider(options: {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
  enabled: boolean;
  readsEnabled: boolean;
  fetch?: typeof fetch;
  now?: () => Date;
}): XOAuthProvider {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const available = Boolean(
    options.enabled && options.clientId && options.clientSecret && options.redirectUri,
  );
  if (options.redirectUri) {
    const url = new URL(options.redirectUri);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/api/v1/studio/x/callback" ||
      (!local && url.origin !== "https://app.pickler.fun") ||
      (local && !["http:", "https:"].includes(url.protocol))
    ) {
      throw new Error("Invalid X_REDIRECT_URI");
    }
  }
  async function request(path: string, init: RequestInit) {
    if (!available) {
      throw new XFailure("X_UNAVAILABLE");
    }
    let response: Response;
    try {
      response = await fetcher(`https://api.x.com/2${path}`, {
        ...init,
        signal: AbortSignal.timeout(5_000),
        redirect: "manual",
      });
    } catch {
      throw new XFailure("X_UNAVAILABLE");
    }
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const seconds =
        header && /^\d+$/.test(header)
          ? Number(header)
          : header
            ? Math.ceil((Date.parse(header) - now().getTime()) / 1000)
            : 60;
      throw new XFailure(
        "X_RATE_LIMITED",
        Math.min(86_400, Math.max(1, Number.isFinite(seconds) ? seconds : 60)),
      );
    }
    if (
      [401, 403].includes(response.status) ||
      (path === "/oauth2/token" && response.status === 400)
    ) {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
    if (!response.ok) {
      throw new XFailure("X_UNAVAILABLE");
    }
    return response;
  }
  async function tokens(body: URLSearchParams, previousRefresh?: string): Promise<XTokens> {
    const response = await request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
      },
      body,
    });
    const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new XFailure("X_UNAVAILABLE");
    }
    const value = parsed.data;
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token ?? previousRefresh ?? "",
      scopes: value.scope.split(/\s+/),
      expiresAt: new Date(now().getTime() + value.expires_in * 1000),
    };
  }
  return {
    available,
    readsAvailable: available && options.readsEnabled,
    authorize(state, challenge) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: options.clientId!,
        redirect_uri: options.redirectUri!,
        scope: X_READ_SCOPES.join(" "),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      return `https://x.com/i/oauth2/authorize?${query}`;
    },
    exchange(code, verifier) {
      return tokens(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: options.redirectUri!,
        }),
      );
    },
    refresh(token) {
      return tokens(
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }),
        token,
      );
    },
    async identity(token) {
      const response = await request("/users/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      const parsed = identitySchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new XFailure("X_UNAVAILABLE");
      }
      return { id: parsed.data.data.id, handle: parsed.data.data.username };
    },
    async posts(token, userId, cursor) {
      if (!options.readsEnabled || cursor) {
        throw new XFailure("X_UNAVAILABLE");
      }
      const query = new URLSearchParams({
        max_results: String(X_POST_PREVIEW_SIZE),
        "tweet.fields": "created_at,author_id",
        exclude: "retweets",
      });
      const response = await request(`/users/${encodeURIComponent(userId)}/tweets?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const parsed = postsSchema.safeParse(await response.json().catch(() => null));
      if (
        !parsed.success ||
        parsed.data.errors?.length ||
        parsed.data.data?.some((post) => post.author_id !== userId || /^RT @/.test(post.text))
      ) {
        throw new XFailure("X_UNAVAILABLE");
      }
      return {
        posts: (parsed.data.data ?? []).map((post) => ({
          id: post.id,
          text: post.text,
          createdAt: post.created_at,
          url: `https://x.com/i/web/status/${post.id}`,
        })),
        nextCursor: null,
      };
    },
    async revoke(token) {
      await request("/oauth2/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ token, client_id: options.clientId! }),
      });
    },
  };
}

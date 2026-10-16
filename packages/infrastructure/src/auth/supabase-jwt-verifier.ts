// Ported from Relayer apps/api/src/core/auth/jwt-verifier.service.ts (commit bb6bb1226e92).
// Behaviour changes:
// - No fallback to `supabase.auth.getUser()`: verification is always local against the JWKS.
// - Issuer is required by the type, so pinning can never be skipped by a missing env var.
// - Failures surface as the core InvalidAccessTokenError.

import {
  InvalidAccessTokenError,
  WALLET_ACCOUNT_METADATA_KEY,
  WALLET_ACCOUNT_METADATA_VALUE,
  type AccessTokenVerifier,
} from "@pickler/core";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface SupabaseJwtVerifierConfig {
  /** e.g. https://<ref>.supabase.co/auth/v1/.well-known/jwks.json */
  jwksUrl: string;
  /** Exact issuer claim Supabase mints, without a trailing slash: https://<ref>.supabase.co/auth/v1 */
  issuer: string;
  /** Supabase uses "authenticated" for signed-in users. */
  audience?: string;
  /** Injected key resolver for tests. */
  keys?: JWTVerifyGetKey;
}

// Only trusted public-key resolvers survive an invocation; tokens and principals never do.
const resolverRegistry = new Map<string, JWTVerifyGetKey>();
function sharedKeys(config: SupabaseJwtVerifierConfig): JWTVerifyGetKey {
  const key = JSON.stringify([config.issuer, config.jwksUrl, config.audience ?? "authenticated"]);
  const existing = resolverRegistry.get(key);
  if (existing) {
    resolverRegistry.delete(key);
    resolverRegistry.set(key, existing);
    return existing;
  }
  const resolver = createRemoteJWKSet(new URL(config.jwksUrl));
  if (resolverRegistry.size >= 8) {
    resolverRegistry.delete(resolverRegistry.keys().next().value!);
  }
  resolverRegistry.set(key, resolver);
  return resolver;
}

export function createSupabaseJwtVerifier(config: SupabaseJwtVerifierConfig): AccessTokenVerifier {
  if (!config.issuer) {
    throw new Error("SupabaseJwtVerifier requires an issuer");
  }
  // jose caches the JWKS and refreshes it on key rotation.
  const keys = config.keys ?? sharedKeys(config);
  const audience = config.audience ?? "authenticated";

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: config.issuer,
          audience,
          algorithms: ["ES256"],
          clockTolerance: "5s",
        });
        if (typeof payload.sub !== "string" || payload.sub.length === 0) {
          throw new Error("JWT missing sub");
        }
        // `app_metadata` is written only with the secret key, so its marker can be trusted where
        // the email cannot: see WALLET_ACCOUNT_METADATA_KEY.
        const appMetadata = payload["app_metadata"];
        const walletAccount =
          typeof appMetadata === "object" &&
          appMetadata !== null &&
          (appMetadata as Record<string, unknown>)[WALLET_ACCOUNT_METADATA_KEY] ===
            WALLET_ACCOUNT_METADATA_VALUE;
        return {
          userId: payload.sub,
          email: typeof payload.email === "string" ? payload.email : undefined,
          walletAccount,
        };
      } catch (cause) {
        throw new InvalidAccessTokenError({ cause });
      }
    },
  };
}

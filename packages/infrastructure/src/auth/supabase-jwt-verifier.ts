// Ported from Relayer apps/api/src/core/auth/jwt-verifier.service.ts (commit bb6bb1226e92).
// Behaviour changes:
// - No fallback to `supabase.auth.getUser()`: verification is always local against the JWKS.
// - Issuer is required by the type, so pinning can never be skipped by a missing env var.
// - Failures surface as the core InvalidAccessTokenError.

import { InvalidAccessTokenError, type AccessTokenVerifier } from "@pickler/core";
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

export function createSupabaseJwtVerifier(config: SupabaseJwtVerifierConfig): AccessTokenVerifier {
  if (!config.issuer) {
    throw new Error("SupabaseJwtVerifier requires an issuer");
  }
  // jose caches the JWKS and refreshes it on key rotation.
  const keys = config.keys ?? createRemoteJWKSet(new URL(config.jwksUrl));
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
        return {
          userId: payload.sub,
          email: typeof payload.email === "string" ? payload.email : undefined,
        };
      } catch (cause) {
        throw new InvalidAccessTokenError({ cause });
      }
    },
  };
}

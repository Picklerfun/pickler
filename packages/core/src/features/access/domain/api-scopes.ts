// Ported from Relayer apps/api/src/core/auth/constants/api-scopes.ts and the narrow
// scopes in core/auth/team-activities/team-activities.constants.ts (commit bb6bb1226e92).
// Values match `public.api_keys.scopes`.

export const API_SCOPES = {
  ADMIN: "admin",
  INTERNAL: "internal",
  INTEGRATOR: "integrator",
  INTEGRATOR_READ: "integrator:read",
  INTEGRATOR_WRITE: "integrator:write",
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

/** Narrow scopes an API key may be issued with. */
export const ALLOWED_API_KEY_SCOPES = [
  "read:agents",
  "read:wallets",
  "read:transactions",
  "sign:prepare",
] as const;

export const isValidScope = (scope: string): scope is ApiScope =>
  (Object.values(API_SCOPES) as string[]).includes(scope);

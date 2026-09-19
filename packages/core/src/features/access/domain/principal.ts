// Ported from Relayer apps/api/src/core/auth/principal/{principal.types,principal.factory}.ts
// and core/auth/utils/super-admin-allowlist.ts (commit bb6bb1226e92).
// Behaviour change: the super-admin allowlist is passed in instead of read from process.env,
// so the business layer stays free of environment access.

import { API_SCOPES } from "./api-scopes.js";
import {
  abilitiesForApiKey,
  abilitiesForMemberRole,
  emptyAbility,
  type AppAbility,
} from "./abilities.js";

export type PrincipalKind = "user" | "apikey" | "agent" | "service";

interface BasePrincipal {
  kind: PrincipalKind;
  /** User id, API key id or agent id, depending on how the caller authenticated. */
  id: string;
  /** `public.integrators.id`; null when no workspace was resolved (for example during signup). */
  tenantId: string | null;
  abilities: AppAbility;
}

export interface UserPrincipal extends BasePrincipal {
  kind: "user";
  email?: string | undefined;
  /** "admin" for the owner, the member's `internal_role` otherwise, null without a workspace. */
  memberRole: string | null;
  /** Informational only; super-admin routes enforce the allowlist separately. */
  isSuperAdmin: boolean;
}

export interface ApiKeyPrincipal extends BasePrincipal {
  kind: "apikey";
  scopes: string[];
}

/** First-party API key carrying the `internal` scope. */
export interface ServicePrincipal extends BasePrincipal {
  kind: "service";
  scopes: string[];
}

export interface AgentPrincipal extends BasePrincipal {
  kind: "agent";
  tenantId: string;
  walletId?: string | undefined;
  status: string;
}

export type Principal = UserPrincipal | ApiKeyPrincipal | ServicePrincipal | AgentPrincipal;

/** Parses a comma-separated allowlist (trimmed, lower-cased, empties dropped). */
export const parseEmailAllowlist = (csv: string | undefined): string[] =>
  (csv ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

/** Fail-closed: an empty allowlist matches nobody. */
export function isAllowlistedEmail(
  email: string | undefined,
  allowlist: readonly string[],
): boolean {
  if (!email || allowlist.length === 0) {
    return false;
  }
  return allowlist.includes(email.trim().toLowerCase());
}

export interface BuildUserPrincipalInput {
  user: { id: string; email?: string | undefined };
  integrator?: { id: string } | null;
  memberRole?: string | null;
  superAdminEmails?: readonly string[];
}

export function buildUserPrincipal(input: BuildUserPrincipalInput): UserPrincipal {
  const memberRole = input.memberRole ?? null;
  return {
    kind: "user",
    id: input.user.id,
    tenantId: input.integrator?.id ?? null,
    email: input.user.email,
    memberRole,
    isSuperAdmin: isAllowlistedEmail(input.user.email, input.superAdminEmails ?? []),
    abilities: memberRole ? abilitiesForMemberRole(memberRole) : emptyAbility(),
  };
}

export function buildApiKeyPrincipal(
  apiKey: { id: string; scopes?: string[] | null },
  tenantId: string | null,
): ApiKeyPrincipal | ServicePrincipal {
  const scopes = apiKey.scopes ?? [];
  const base = {
    id: apiKey.id,
    tenantId,
    scopes,
    // Every key is evaluated against explicit scope grants.
    abilities: abilitiesForApiKey(scopes),
  };
  return scopes.includes(API_SCOPES.INTERNAL)
    ? { kind: "service", ...base }
    : { kind: "apikey", ...base };
}

export function buildAgentPrincipal(agent: {
  id: string;
  integrator_id: string;
  wallet_id?: string | null;
  status: string;
}): AgentPrincipal {
  return {
    kind: "agent",
    id: agent.id,
    tenantId: agent.integrator_id,
    walletId: agent.wallet_id ?? undefined,
    status: agent.status,
    // An agent's authority comes from HMAC auth, wallet policies and budget, not abilities.
    abilities: emptyAbility(),
  };
}

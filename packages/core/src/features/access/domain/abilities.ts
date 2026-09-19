// Ported from Relayer apps/api/src/core/auth/casl-ability.factory.ts (commit bb6bb1226e92).
// Behaviour change: API keys require explicit grants; read:agents grants read-only agent access.
// `createForWorkspaceRole` is not ported (no production caller).

import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";

export const MEMBER_ROLES = ["admin", "manager", "developer", "auditor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type Subjects =
  | "Exchange"
  | "Payout"
  | "Signing"
  | "Action"
  | "Agent"
  | "Team"
  | "Settings"
  | "Integrator"
  | "AuditLog"
  | "SignoffRules"
  | "Admin"
  | "ApiKeys"
  | "all";

export type Actions = "read" | "create" | "update" | "delete" | "manage";

export type AppAbility = MongoAbility<[Actions, Subjects]>;

/** Ability with no rules: every `.can()` is false. */
export const emptyAbility = (): AppAbility => createMongoAbility<[Actions, Subjects]>([]);

/**
 * Team-member role from `integrator_members.internal_role`. Owners are resolved as "admin".
 * Unknown roles (for example an out-of-band database write) get no abilities.
 */
export function abilitiesForMemberRole(role: MemberRole | string): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  switch (role) {
    case "admin":
      can("manage", "all");
      break;
    case "manager":
      can("read", "all");
      can("create", ["Exchange", "Payout", "Signing", "Action"]);
      can("update", ["Exchange", "Payout", "Signing", "Action"]);
      can("delete", ["Exchange", "Payout", "Signing"]);
      // Governance surfaces stay hidden from operational roles (CASL: later rules win).
      cannot("read", "AuditLog");
      cannot("read", "SignoffRules");
      break;
    case "auditor":
      can("read", "all");
      break;
    case "developer":
      can("read", "all");
      cannot("read", "AuditLog");
      cannot("read", "SignoffRules");
      can("manage", "ApiKeys");
      break;
    case "viewer":
      can("read", ["Exchange", "Payout", "Signing"]);
      break;
    default:
      break;
  }

  return build();
}

/**
 * API keys never receive `manage` on anything, even if a stored row carries a `manage:*` scope.
 * Only the narrow issued scopes map to abilities.
 */
export function abilitiesForApiKey(scopes: readonly string[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const scope of scopes) {
    if (scope.startsWith("manage:")) {
      continue;
    }
    if (scope === "read:wallets" || scope === "read:transactions") {
      can("read", "Signing");
    }
    if (scope === "read:agents") {
      can("read", "Agent");
    }
    if (scope === "sign:prepare") {
      can("create", "Signing");
    }
  }
  return build();
}

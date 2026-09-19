// Ported from Relayer apps/api/src/core/auth/guards/permission.guard.ts (commit bb6bb1226e92):
// the decision tree only, without NestJS. The HTTP layer maps the result to 403.

import type { Actions, Subjects } from "./abilities.js";
import type { Principal } from "./principal.js";

export type PermissionDecision = { allowed: true } | { allowed: false; reason: string };

const allow: PermissionDecision = { allowed: true };
const deny = (reason: string): PermissionDecision => ({ allowed: false, reason });

export function checkPermission(
  principal: Principal | null,
  required: { action: Actions; subject: Subjects } | null,
): PermissionDecision {
  if (!required) {
    return allow;
  }
  if (!principal) {
    return deny("Not authenticated");
  }

  switch (principal.kind) {
    case "apikey":
    case "service":
      if (!principal.tenantId) {
        return deny("No integrator context");
      }
      return principal.abilities.can(required.action, required.subject)
        ? allow
        : deny("Insufficient permissions");
    case "agent":
      // Bounded by HMAC, wallet policies and budget instead.
      return allow;
    case "user":
      if (!principal.tenantId) {
        return deny("No integrator context");
      }
      if (!principal.memberRole) {
        return deny("Not a member");
      }
      return principal.abilities.can(required.action, required.subject)
        ? allow
        : deny("Insufficient permissions");
  }
}

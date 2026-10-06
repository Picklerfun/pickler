import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import { createStudioAccess, type StudioDirectory } from "./access.js";

export interface StudioAccessRequest {
  status: "not_requested" | "pending" | "enabled";
  requestedAt: Date | null;
}
export interface StudioAccessRequestEntry {
  userId: string;
  handle: string;
  displayName: string;
  requestedAt: Date;
}
export interface StudioAccessRequestRepository {
  read(userId: string): Promise<StudioAccessRequest>;
  request(userId: string, workspaceId: string): Promise<StudioAccessRequest>;
  pending(): Promise<StudioAccessRequestEntry[]>;
}

export function createStudioAccessRequests(
  directory: StudioDirectory,
  repository: StudioAccessRequestRepository,
) {
  const access = createStudioAccess(directory);
  function user(principal: Principal) {
    if (principal.kind !== "user") {
      throw new AccessDeniedError("User session required");
    }
    return principal;
  }
  return {
    async read(principal: Principal) {
      const caller = user(principal);
      return { ...(await repository.read(caller.id)), canReviewRequests: caller.isSuperAdmin };
    },
    async request(principal: Principal) {
      const caller = user(principal);
      const current = await access.authorize(caller);
      if (current.ownerUserId !== caller.id) {
        throw new AccessDeniedError("Only the workspace owner can request creator access");
      }
      return repository.request(caller.id, current.workspaceId);
    },
    async pending(principal: Principal) {
      if (!user(principal).isSuperAdmin) {
        throw new AccessDeniedError("Operator access required");
      }
      return repository.pending();
    },
  };
}

import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import type { ApplicationStatus } from "../applications/ports/application-review-repository.js";

export interface StudioAccessRequest {
  status: "not_requested" | "pending" | "enabled";
  requestedAt: Date | null;
  /** The status of the application sent under this account's email, or null without one. */
  application: ApplicationStatus | null;
}
export interface StudioAccessRequestEntry {
  userId: string;
  handle: string;
  displayName: string;
  requestedAt: Date;
}
export interface StudioAccessRequestRepository {
  read(userId: string, email?: string | undefined): Promise<StudioAccessRequest>;
  pending(): Promise<StudioAccessRequestEntry[]>;
}

/**
 * Creator access as a person and an operator read it. Requesting access from the studio was
 * retired on 2026-10-08 (docs/specs/landing-trade-v1.md §7): the way in is the public application,
 * reviewed by `createApplicationReview`, and a person's status carries their application's state
 * so the studio can say where they stand. `pending` still lists the requests recorded before that.
 */
export function createStudioAccessRequests(repository: StudioAccessRequestRepository) {
  function user(principal: Principal) {
    if (principal.kind !== "user") {
      throw new AccessDeniedError("User session required");
    }
    return principal;
  }
  return {
    async read(principal: Principal) {
      const caller = user(principal);
      return {
        ...(await repository.read(caller.id, caller.email)),
        canReviewRequests: caller.isSuperAdmin,
      };
    },
    async pending(principal: Principal) {
      if (!user(principal).isSuperAdmin) {
        throw new AccessDeniedError("Operator access required");
      }
      return repository.pending();
    },
  };
}

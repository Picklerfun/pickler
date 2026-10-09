import { AccessDeniedError } from "../../access/domain/errors.js";
import type { Principal } from "../../access/domain/principal.js";
import type {
  ApplicationDecision,
  ApplicationReviewEntry,
  ApplicationReviewFilter,
  ApplicationReviewRepository,
  ApplicationStatus,
} from "../ports/application-review-repository.js";

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "submitted",
  "invited",
  "rejected",
];
export const APPLICATION_DECISIONS: readonly ApplicationDecision[] = ["invited", "rejected"];
export const DECISION_NOTE_MAX = 500;

export class ApplicationNotFoundError extends Error {
  constructor(readonly id: number) {
    super(`Application ${id} not found`);
    this.name = "ApplicationNotFoundError";
  }
}

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

/**
 * Reviewing creator applications: the operators' side of /apply.
 *
 * Only a super admin — a user whose email is on the server's allowlist — may list or decide.
 * A decision is `invited` or `rejected`, with an optional note, and is recorded with the reviewer's
 * email so the decision has a name on it. It does not enable studio access or send any email:
 * those stay the operator command and a later piece, which is what the studio's own notice says.
 */
export function createApplicationReview(repository: ApplicationReviewRepository) {
  function operator(principal: Principal) {
    if (principal.kind !== "user" || !principal.isSuperAdmin) {
      throw new AccessDeniedError("Operator access required");
    }
    return principal;
  }

  return {
    async list(principal: Principal, filter: ApplicationReviewFilter = {}) {
      operator(principal);
      if (filter.status && !APPLICATION_STATUSES.includes(filter.status)) {
        throw new ReviewValidationError(`Unknown status "${filter.status}"`);
      }
      return repository.list(filter);
    },

    async review(
      principal: Principal,
      id: number,
      decision: ApplicationDecision,
      note: string | null | undefined,
    ): Promise<ApplicationReviewEntry> {
      const caller = operator(principal);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ReviewValidationError("Application id must be a positive integer");
      }
      if (!APPLICATION_DECISIONS.includes(decision)) {
        throw new ReviewValidationError(`Unknown decision "${decision}"`);
      }
      const trimmed = note?.trim() ?? "";
      if (trimmed.length > DECISION_NOTE_MAX) {
        throw new ReviewValidationError(`Keep the note under ${DECISION_NOTE_MAX} characters`);
      }
      const reviewer = caller.email?.trim().toLowerCase() || caller.id;
      const entry = await repository.review(id, decision, trimmed || null, reviewer);
      if (!entry) {
        throw new ApplicationNotFoundError(id);
      }
      return entry;
    },
  };
}

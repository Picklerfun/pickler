import type { Application } from "../domain/application.js";

export type ApplicationStatus = "submitted" | "invited" | "rejected";

/** What an operator can decide. `submitted` is where an application starts, never a decision. */
export type ApplicationDecision = "invited" | "rejected";

/** One application as the operator sees it: the answers, who sent them, and the decision so far. */
export interface ApplicationReviewEntry extends Application {
  /** The waitlist seat the application belongs to; the application's own key. */
  id: number;
  email: string;
  status: ApplicationStatus;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  decisionNote: string | null;
  invitedAt: Date | null;
}

export interface ApplicationReviewFilter {
  /** Only this status; every status when absent. */
  status?: ApplicationStatus | null | undefined;
}

export interface ApplicationReviewRepository {
  /** Newest first. */
  list(filter: ApplicationReviewFilter): Promise<ApplicationReviewEntry[]>;
  /** Records the decision and answers the entry as it now stands, or null for an unknown id. */
  review(
    id: number,
    decision: ApplicationDecision,
    note: string | null,
    reviewer: string,
  ): Promise<ApplicationReviewEntry | null>;
}

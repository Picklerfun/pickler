import type { Applicant, Application } from "../domain/application.js";

export type SubmitOutcome =
  "submitted" | "not_found" | "already_submitted" | "ticker_taken" | "handle_taken";

export interface ApplicantRepository {
  /** Resolves the secret apply token issued at signup. Unknown or malformed tokens resolve to null. */
  findByToken(token: string): Promise<Applicant | null>;
  /** Atomically stores the application and holds its ticker and X handle. */
  submit(token: string, application: Application): Promise<SubmitOutcome>;
  /** False when the ticker belongs to an agent or another application. */
  isTickerAvailable(ticker: string): Promise<boolean>;
}

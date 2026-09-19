import {
  ApplicantNotFoundError,
  ApplicationAlreadySubmittedError,
  ApplicationValidationError,
  HandleTakenError,
  normalizeTicker,
  TickerTakenError,
  validateApplication,
  type Applicant,
  type ApplicationInput,
} from "../domain/application.js";
import type { ApplicantRepository } from "../ports/applicant-repository.js";

export function createGetApplicant(repository: ApplicantRepository) {
  return async (token: string | null): Promise<Applicant | null> =>
    token ? repository.findByToken(token) : null;
}

export function createSubmitApplication(repository: ApplicantRepository) {
  return async (token: string | null, input: ApplicationInput): Promise<Applicant> => {
    if (!token) {
      throw new ApplicantNotFoundError();
    }
    const application = validateApplication(input);

    switch (await repository.submit(token, application)) {
      case "not_found":
        throw new ApplicantNotFoundError();
      case "already_submitted":
        throw new ApplicationAlreadySubmittedError();
      case "ticker_taken":
        throw new TickerTakenError(application.ticker);
      case "handle_taken":
        throw new HandleTakenError(application.xHandle);
      case "submitted":
        break;
    }

    const applicant = await repository.findByToken(token);
    if (!applicant) {
      throw new ApplicantNotFoundError();
    }
    return applicant;
  };
}

export function createCheckTicker(repository: ApplicantRepository) {
  return async (raw: string): Promise<{ ticker: string; available: boolean }> => {
    const ticker = normalizeTicker(raw);
    if (!ticker) {
      throw new ApplicationValidationError([
        { field: "ticker", message: "Use 2 to 6 letters or digits, starting with a letter." },
      ]);
    }
    return { ticker, available: await repository.isTickerAvailable(ticker) };
  };
}

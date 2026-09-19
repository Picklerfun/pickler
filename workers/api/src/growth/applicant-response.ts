import { effectiveLinePosition, type Applicant } from "@pickler/core";
import type { ApplicantResponse } from "@pickler/api-schema";

export function toApplicantResponse(applicant: Applicant): ApplicantResponse {
  const position = effectiveLinePosition(applicant);
  return {
    email: applicant.email,
    position,
    referralCode: applicant.referralCode,
    referrals: applicant.referrals,
    placesGained: applicant.linePosition - position,
    application: applicant.application && {
      ...applicant.application,
      submittedAt: applicant.application.submittedAt.toISOString(),
    },
  };
}

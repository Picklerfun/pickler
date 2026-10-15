"use client";

import type { ApplicantResponse } from "@pickler/api-schema";
import { useState } from "react";
import { ApplicationForm } from "./application-form";
import { Submitted } from "./submitted";

/**
 * The form, or what it became. A browser that already holds a seat with an application sees
 * SUBMITTED on load (spec A2), read server-side; one that holds a seat without one gets its email
 * filled in; everyone else starts blank.
 */
export function ApplicationSection({
  initial,
  referralCode,
}: {
  initial: ApplicantResponse | null;
  referralCode: string | null;
}) {
  const [applicant, setApplicant] = useState(initial);
  if (applicant?.application) {
    return <Submitted applicant={applicant} application={applicant.application} />;
  }
  return (
    <ApplicationForm
      initialEmail={applicant?.email ?? ""}
      referralCode={referralCode}
      onSubmitted={(next) => {
        setApplicant(next);
        document.getElementById("apply")?.scrollIntoView();
      }}
    />
  );
}

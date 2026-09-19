"use client";

import type { ApplicantResponse } from "@pickler/api-schema";
import { useState } from "react";
import { ApplicationForm } from "./application-form";
import { Submitted } from "./submitted";

export function ApplyFlow({ initial }: { initial: ApplicantResponse }) {
  const [applicant, setApplicant] = useState(initial);
  if (applicant.application) {
    return (
      <Submitted
        applicant={applicant}
        application={applicant.application}
        onRefresh={setApplicant}
      />
    );
  }
  return (
    <ApplicationForm
      email={applicant.email}
      onSubmitted={(next) => {
        setApplicant(next);
        window.scrollTo({ top: 0 });
      }}
    />
  );
}

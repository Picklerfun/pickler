import type { Metadata } from "next";
import { ApplyFlow } from "@/features/apply/components/apply-flow";
import { ApplyShell } from "@/features/apply/components/apply-shell";
import { NoSeat } from "@/features/apply/components/no-seat";
import { services } from "@/server/container";
import { toApplicantResponse } from "@/server/http/applicant-response";
import { readApplyToken } from "@/server/http/apply-cookie";

export const metadata: Metadata = {
  title: "Apply — Pickler",
  description: "Tell us what you would build. Six answers, two minutes.",
  robots: { index: false },
};

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const applicant = await services.getApplicant(await readApplyToken());
  if (!applicant) {
    const { ref } = await searchParams;
    return (
      <ApplyShell>
        <NoSeat referralCode={typeof ref === "string" ? ref : null} />
      </ApplyShell>
    );
  }
  return (
    <ApplyShell>
      <ApplyFlow initial={toApplicantResponse(applicant)} />
    </ApplyShell>
  );
}

import type { Metadata } from "next";
import { ApplyPage } from "@/features/apply/components/apply-page";
import { services } from "@/server/container";
import { readApplyToken } from "@/server/http/apply-cookie";

export const metadata: Metadata = {
  title: "Create an agent — Pickler",
  description:
    "An agent on Pickler is an AI that calls markets in public, trades inside your limits and sells its reads to traders. Tell us what you would build: six answers, two minutes.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  // A browser holding a seat is recognised server-side, so one that already applied lands on
  // SUBMITTED rather than on an empty form. Everyone else gets the form; the page is public.
  const applicant = await services.getApplicant(await readApplyToken());
  const { ref } = await searchParams;
  return <ApplyPage initial={applicant} referralCode={typeof ref === "string" ? ref : null} />;
}

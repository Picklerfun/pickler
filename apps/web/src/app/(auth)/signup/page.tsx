import type { Metadata } from "next";
import { SignUpFlow } from "@/features/auth/components/sign-up-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account — Pickler" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ complete?: string }>;
}) {
  const [snapshot, { complete }] = await Promise.all([services.getLanding(), searchParams]);
  return <SignUpFlow board={toAuthBoardData(snapshot)} completeProfile={complete === "1"} />;
}

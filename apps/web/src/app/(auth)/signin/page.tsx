import type { Metadata } from "next";
import { SignInCard } from "@/features/auth/components/sign-in-card";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Pickler" };

export default async function SignInPage() {
  return <SignInCard board={toAuthBoardData(await services.getLanding())} />;
}

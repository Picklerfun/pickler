import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Pickler" };

export default async function SignInPage() {
  return <PasskeyFlow board={toAuthBoardData(await services.getLanding())} mode="in" />;
}

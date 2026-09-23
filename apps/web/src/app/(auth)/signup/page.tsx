import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account — Pickler" };

export default async function SignUpPage() {
  return <PasskeyFlow board={toAuthBoardData(await services.getLanding())} mode="up" />;
}

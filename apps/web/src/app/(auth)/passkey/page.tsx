import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Passkey — Pickler" };

/**
 * Passkeys, as their own page: another passkey on a sub-organization that exists, and the list of
 * what is on it. Nothing else.
 *
 * The master wallet is created in exactly one place, the signup's mandatory passkey step (spec
 * §4.1). A signed-in person without one who reaches this page is sent there, like from every other
 * signed-in screen (`redirectFor` in `lib/custody.ts`).
 */
export default async function PasskeyPage() {
  return <PasskeyFlow board={toAuthBoardData(await services.getLanding())} mode="add" />;
}

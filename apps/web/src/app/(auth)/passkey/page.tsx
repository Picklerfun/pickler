import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { passkeyPreviewFromSearch } from "@/features/auth/lib/passkey-entry";
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
export default async function PasskeyPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const search = await searchParams;
  // `?state=add` is the design preview of this screen (see `lib/passkey-entry.ts`).
  return (
    <PasskeyFlow
      board={toAuthBoardData(await services.getLanding())}
      mode="add"
      passkeyPreview={passkeyPreviewFromSearch(process.env.NODE_ENV, search.state)}
    />
  );
}

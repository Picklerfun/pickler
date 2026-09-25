import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { passkeyPreviewFromSearch } from "@/features/auth/lib/passkey-preview";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Passkey — Pickler" };

/**
 * Passkeys, as their own page: where a sub-organization is born for anyone who reached a signed-in
 * screen without one (spec §4.1), and where one that exists gets another passkey.
 *
 * Sign-up's mandatory passkey step creates the sub-organization and its master wallet for almost
 * everybody. This page catches the rest: a sign-up closed at that step, and an account from before
 * the step was mandatory. The studio shell redirects a person with no sub-organization here before
 * rendering anything else. `PasskeyFlow`'s `add` mode reads which applies (`passkeyScreenFor` in
 * `lib/custody.ts`) and draws either "Create your wallet" — the same enrolment ceremony, with no
 * way past it but a wallet — or the add-a-device screen.
 *
 * `?state=create` opens the create screen without reading the account, outside production only,
 * for the design harness: see `passkeyPreviewFromSearch`.
 */
export default async function PasskeyPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const search = await searchParams;
  return (
    <PasskeyFlow
      board={toAuthBoardData(await services.getLanding())}
      mode="add"
      preview={passkeyPreviewFromSearch(process.env.NODE_ENV, search.state)}
    />
  );
}

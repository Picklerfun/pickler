import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Passkey — Pickler" };

/**
 * Passkeys, as their own page — and, since the studio-create-and-fund specification, only that.
 *
 * This used to be where a sub-organization was born: the enrolment ceremony that creates it,
 * mounted on the same rail signup once used. That moved. A sub-organization is now created in
 * exactly one place — the first agent's "Create and run it once", in
 * `features/studio/create/ceremony.ts` — so this page can no longer start one, and does not try
 * to. What is left is real work of its own: adding a second passkey to a sub-organization that
 * already exists, and showing which ones are on it. `PasskeyFlow`'s `add` mode reads which of the
 * two applies (`passkeyScreenFor` in `lib/custody.ts`) and draws the right screen; a person with no
 * sub-organization yet is sent to `/studio/new`, not offered a button that would make one here.
 *
 * It is reached, never redirected to: `/account` offers it where it already says there is no
 * wallet, and the screen it lands on for that person says so and points at the studio instead.
 */
export default async function PasskeyPage() {
  return <PasskeyFlow board={toAuthBoardData(await services.getLanding())} mode="add" />;
}

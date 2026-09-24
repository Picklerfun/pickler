import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { services } from "@/server/container";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your wallet — Pickler" };

/**
 * Taking custody, as its own page.
 *
 * The sub-organization is created when somebody builds their first agent rather than at signup, so
 * the ceremony needed somewhere to live that is neither. It is a page rather than a sheet because
 * that is what it already was — the same rail, the same steps and the same passkey sheet the
 * sign-up flow used, mounted on the mode Task 16 gave them. Nothing here is new.
 *
 * The address is `/passkey` and the concept is still custody. The passkey becomes the root quorum
 * of a Turnkey sub-organization, which is what makes the wallet self-custodial, and that is what
 * the spec, `flow.ts`'s `custody` mode and the `custody_started` event all keep calling it. But
 * nobody thinks "I will go and do custody", and the canvas never asks them to: the rail reads
 * PASSKEY and the screen reads "YOUR KEY. NOT OURS." The word is right; the URL was not.
 *
 * It is reached, never redirected to: `/account` offers it where it already says there is no
 * wallet, and the studio points at it when an agent has none to fund. Somebody who arrives has
 * chosen the prompt, which is the whole reason this stopped happening at the door.
 */
export default async function PasskeyPage() {
  return <PasskeyFlow board={toAuthBoardData(await services.getLanding())} mode="custody" />;
}

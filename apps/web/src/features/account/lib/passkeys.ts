// What one passkey row says about itself, kept pure so node:test drives every combination of the
// two nullable columns without a browser.

import type { PasskeyDto } from "../../auth/lib/custody-api";
import { monthUtc } from "./dates";

/** Turnkey's own words for the two device classes, in the ones a person uses. */
const DEVICE: Record<string, string> = {
  multiDevice: "SYNCED ACROSS DEVICES",
  singleDevice: "THIS DEVICE ONLY",
};

/**
 * The meta line under a passkey's name.
 *
 * Both nullable fields are answered by saying less rather than by guessing. A null `device_type`
 * drops the phrase — the row still has a name and a date — and a null `last_used_at` reads NEVER
 * USED, which is true and is worth knowing: a backup nobody has ever signed with is exactly the
 * one to check before relying on it. Substituting the creation date there would be invisible and
 * would quietly turn "never used" into "used the day you made it".
 */
export function passkeyMeta(passkey: PasskeyDto): string {
  const added = monthUtc(passkey.created_at);
  const used = monthUtc(passkey.last_used_at);
  return [
    passkey.device_type === null ? null : (DEVICE[passkey.device_type] ?? null),
    added === null ? null : `ADDED ${added}`,
    passkey.last_used_at === null ? "NEVER USED" : used === null ? null : `LAST USED ${used}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Why a passkey cannot be removed, or null when it could be.
 *
 * There are two reasons and they are not the same, so the title says which. Removal is not built —
 * no route deletes a passkey — and that is the reason for every row today. The other reason
 * outlives it: the last passkey on an account is the only way into the funds, and removing it
 * locks them for good. Keeping both means the day the route lands, the one-key rule is already
 * here rather than being remembered.
 */
export function removalBlocked(count: number): string {
  return count <= 1
    ? "This is the only passkey on the account. Add another before removing this one — without it nothing can move your funds."
    : "Removing a passkey is not built yet: no route deletes one.";
}

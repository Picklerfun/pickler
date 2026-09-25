// What one row of /passkey's device list says about itself, kept pure so node:test drives every
// combination of the two nullable columns without a browser. A smaller cousin of
// features/account/lib/passkeys.ts's `passkeyMeta`: this screen only ever lists, it never offers
// coverage advice or removal, so it does not need that file's risk copy — just the same two facts
// this feature already knows how to write, `describePasskeyStore` and the device's own label.

import type { PasskeyDto } from "./custody-api";

/** "MARCH 2026" from an ISO stamp, or null when there is nothing readable. Fixed to UTC so the
 *  same row does not name a different month depending on the reader's own clock. */
function monthUtc(stamp: string | null | undefined): string | null {
  if (!stamp) {
    return null;
  }
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) {
    return null;
  }
  const month = when.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `${month} ${when.getUTCFullYear()}`.toUpperCase();
}

/**
 * The meta line under a passkey's name on /passkey's device list.
 *
 * Both nullable fields are answered by saying less rather than by guessing, the same rule
 * `passkeyMeta` follows: a null `last_used_at` reads NEVER USED, which is true and worth knowing
 * — a backup nobody has signed with yet is exactly the one to check — rather than being filled in
 * with the creation date, which would quietly turn "never used" into "used the day it was made".
 */
export function passkeyLine(passkey: PasskeyDto): string {
  const added = monthUtc(passkey.created_at);
  const used = monthUtc(passkey.last_used_at);
  return [
    added === null ? null : `ADDED ${added}`,
    passkey.last_used_at === null ? "NEVER USED" : used === null ? null : `LAST USED ${used}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

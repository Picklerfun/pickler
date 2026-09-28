// The two things the public-profile section can say that are true, kept pure so node:test drives
// them without a browser.

import { monthUtc } from "./dates";

/** "JOINED MARCH 2026" from the profile's `created_at`, or nothing when there is no date to read. */
export function joinedLabel(createdAt: string | null | undefined): string | null {
  const month = monthUtc(createdAt);
  return month === null ? null : `JOINED ${month}`;
}

/**
 * The address this account's public page would have, for the button that offers to copy it.
 *
 * It takes the origin rather than a domain constant because no domain is written down anywhere in
 * this repository, and hardcoding the one the canvas draws would put a host on screen that this
 * deployment may not answer on.
 */
export function profileLink(origin: string, handle: string): string {
  return `${origin.replace(/^https?:\/\//, "")}/@${handle}`;
}

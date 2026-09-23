// The two things the public-profile section can say that are true, kept pure so node:test drives
// them without a browser.

/**
 * "JOINED MARCH 2026" from the profile's `created_at`.
 *
 * Fixed to UTC rather than the reader's zone: the same account would otherwise read as a different
 * month either side of a date line, and the month somebody joined is not a fact that should move
 * with the reader. An unparseable stamp answers null, so the line is left out rather than printed
 * as "JOINED INVALID DATE".
 */
export function joinedLabel(createdAt: string | null | undefined): string | null {
  if (!createdAt) {
    return null;
  }
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) {
    return null;
  }
  const month = when.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `JOINED ${month} ${when.getUTCFullYear()}`.toUpperCase();
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

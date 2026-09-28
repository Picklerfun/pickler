/**
 * "MARCH 2026" from an ISO stamp, or null when there is no readable date.
 *
 * Fixed to UTC rather than the reader's zone: the same row would otherwise name a different month
 * either side of a date line, and when somebody joined — or last used a key — is not a fact that
 * should move with whoever is looking. An unparseable stamp answers null so the caller leaves the
 * phrase out rather than printing "INVALID DATE".
 */
export function monthUtc(stamp: string | null | undefined): string | null {
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

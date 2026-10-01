/*
 * What the person probably meant. A mistyped handle ("halftme") and a half-remembered search
 * ("funding arb") both deserve a way forward that is not the whole directory, and both are
 * answered from the directory the page already has, never from a second request.
 */

/** Edits (insert, delete, substitute) between two strings. */
export function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * The handles closest to one that does not exist, nearest first, at most `limit`.
 *
 * Close means a few typos away, or sharing the first three characters: "hal" and "halfpipe" are
 * both close to "halftme", and "counter" is not. Anything further is not a suggestion, and an
 * empty list says "no close matches" rather than offering strangers.
 */
export function nearestHandles<T extends { handle: string }>(
  asked: string,
  candidates: readonly T[],
  limit = 3,
): T[] {
  const wanted = asked.trim().replace(/^@/, "").toLowerCase();
  if (wanted === "") {
    return [];
  }
  const allowed = Math.max(2, Math.floor(wanted.length / 3));
  return candidates
    .map((candidate) => {
      const handle = candidate.handle.toLowerCase();
      const edits = distance(wanted, handle);
      const shared = wanted.length >= 3 && handle.startsWith(wanted.slice(0, 3));
      return { candidate, edits, close: edits <= allowed || shared };
    })
    .filter((entry) => entry.close && entry.candidate.handle.toLowerCase() !== wanted)
    .sort((a, b) => a.edits - b.edits || a.candidate.handle.localeCompare(b.candidate.handle))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** The words of a search, lower-cased, without the empty ones. */
export const terms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Whether an agent answers a search: every word must appear in its handle, name, beat, venue or
 * what it decides. Every word, so that adding a word narrows, which is what a person expects.
 */
export function matches(query: string, fields: readonly string[]): boolean {
  const haystack = fields.join(" ").toLowerCase();
  return terms(query).every((term) => haystack.includes(term));
}

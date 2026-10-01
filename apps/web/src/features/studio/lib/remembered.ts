/**
 * A read made at most once, for a value that cannot change while the page is open.
 *
 * The promise is what is kept, so two callers asking at the same moment share one read. A read
 * that fails is forgotten before anyone is told, so the next caller tries again rather than being
 * handed the same failure for the rest of the session. Pinned in `studio-remembered.test.ts`.
 */
export function remembered<T>(read: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | null = null;
  return () => {
    if (!kept) {
      const reading = read();
      kept = reading;
      reading.catch(() => {
        if (kept === reading) {
          kept = null;
        }
      });
    }
    return kept;
  };
}

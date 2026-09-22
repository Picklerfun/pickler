/** Read-only polling: no overlapping requests, and no work while the page is hidden. */
export function startPolling(
  read: (signal: AbortSignal) => Promise<number | null>,
  onError: (error: unknown) => void,
  page: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document,
): () => void {
  let stopped = false;
  let request: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll() {
    if (stopped || page.hidden || request) {
      return;
    }
    const current = new AbortController();
    request = current;
    let delay: number | null = 3000;
    try {
      delay = await read(current.signal);
    } catch (error) {
      if (!current.signal.aborted && !stopped) {
        onError(error);
      }
    } finally {
      if (request === current) {
        request = undefined;
        if (!stopped && !page.hidden && !current.signal.aborted && delay !== null) {
          timer = setTimeout(() => void poll(), delay);
        }
      }
    }
  }

  function visibility() {
    clearTimeout(timer);
    request?.abort();
    request = undefined;
    if (!page.hidden) {
      void poll();
    }
  }

  page.addEventListener("visibilitychange", visibility);
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    request?.abort();
    page.removeEventListener("visibilitychange", visibility);
  };
}

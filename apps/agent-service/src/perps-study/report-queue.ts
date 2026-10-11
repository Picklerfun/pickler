/** Coalesce requests while one report is being produced; never overlap generations. */
export function createReportQueue(work: () => Promise<void>, failed: (error: unknown) => void) {
  let pending = false;
  let active: Promise<void> | undefined;
  let error: unknown;
  function request() {
    pending = true;
    if (active || error) {
      return;
    }
    active = (async () => {
      while (pending) {
        pending = false;
        await work();
      }
    })()
      .catch((failure) => {
        error = failure;
        failed(failure);
      })
      .finally(() => {
        active = undefined;
      });
  }
  return {
    request,
    async flush() {
      while (active || pending) {
        if (error) {
          throw error;
        }
        if (!active) {
          request();
        }
        await active;
      }
      if (error) {
        throw error;
      }
    },
  };
}

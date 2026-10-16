/** Invocation-local deduplication and a four-read ceiling. Never retain personal balances globally. */
export function boundedBalanceReads(reader: {
  read(address: string): Promise<number>;
  forget(address: string): void;
}) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const reads = new Map<string, Promise<number>>();
  return {
    read(address: string): Promise<number> {
      const key = address.toLowerCase();
      const previous = reads.get(key);
      if (previous) {
        return previous;
      }
      const pending = (async () => {
        if (active >= 4) {
          await new Promise<void>((resolve) => waiting.push(resolve));
        } else {
          active++;
        }
        try {
          return await reader.read(address);
        } finally {
          const next = waiting.shift();
          if (next) {
            next();
          } else {
            active--;
          }
        }
      })();
      reads.set(key, pending);
      pending.catch(() => {
        if (reads.get(key) === pending) {
          reads.delete(key);
        }
      });
      return pending;
    },
    forget(address: string) {
      reads.delete(address.toLowerCase());
      reader.forget(address);
    },
  };
}

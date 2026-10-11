import type { Rpc } from "../chain/erc20.js";

interface PendingRead {
  method: string;
  params: unknown[];
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

/** Reserve each group's actual reads before transport, with no retry or SQL lock over RPC. */
export function createIndexerRpcAdmission(input: {
  rpc: Rpc;
  maxRequests: number;
  reserve: (count: number) => Promise<boolean>;
}) {
  const queue: PendingRead[] = [];
  let active: Promise<void> | undefined;
  let stopped = false;
  let calls = 0;

  function rejectQueued(error: unknown) {
    for (const read of queue.splice(0)) {
      read.reject(error);
    }
  }

  async function drain() {
    let batch: PendingRead[] = [];
    try {
      while (!stopped && queue.length > 0) {
        batch = queue.splice(0, 4);
        if (calls + batch.length > input.maxRequests) {
          throw new Error("INDEX_PASS_BUDGET_EXHAUSTED");
        }
        if (!(await input.reserve(batch.length))) {
          throw new Error("INDEX_LEASE_OR_DAILY_BUDGET_UNAVAILABLE");
        }
        if (stopped) {
          throw new Error("INDEX_PASS_STOPPED");
        }

        calls += batch.length;
        const results = await Promise.allSettled(
          batch.map(async (read) => {
            try {
              read.resolve(await input.rpc.call(read.method, read.params));
            } catch (error) {
              read.reject(error);
              throw error;
            }
          }),
        );
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          throw failure.reason;
        }
        batch = [];
      }
    } catch (error) {
      stopped = true;
      for (const read of batch) {
        read.reject(error);
      }
      rejectQueued(error);
    } finally {
      active = undefined;
    }
  }

  const rpc: Rpc = {
    call(method, params) {
      if (stopped) {
        return Promise.reject(new Error("INDEX_PASS_STOPPED"));
      }
      const result = new Promise<unknown>((resolve, reject) => {
        queue.push({ method, params, resolve, reject });
      });
      // Gather synchronous range reads before reserving. In-flight groups never exceed four.
      active ??= Promise.resolve().then(drain);
      return result;
    },
  };

  return {
    rpc,
    get calls() {
      return calls;
    },
    async stop() {
      stopped = true;
      rejectQueued(new Error("INDEX_PASS_STOPPED"));
      await active;
    },
  };
}

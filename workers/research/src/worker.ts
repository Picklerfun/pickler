import { consumeWakeup, reconcile } from "@pickler/agent-runtime";
import type { PostgresResearchStore } from "@pickler/infrastructure";
import type { createRuntime } from "@pickler/agent-runtime";
import type { Env } from "./index.js";

type Runtime = Pick<ReturnType<typeof createRuntime>, "repository" | "execute">;

/** Dependency injection is for host tests, never an environment-selected provider fallback. */
export function createResearchWorker(deps: {
  runtime(env: Env): Runtime;
  repository(env: Env): PostgresResearchStore;
}): ExportedHandler<Env, { kind: "research-wakeup" }> {
  return {
    async queue(batch, env) {
      for (const message of batch.messages) {
        if (env.ADMISSIONS_ENABLED !== "true" || message.body?.kind !== "research-wakeup") {
          message.ack();
          continue;
        }
        try {
          const runtime = deps.runtime(env);
          await consumeWakeup(runtime.repository, runtime.execute, {
            send: async (body) => {
              await env.RESEARCH_QUEUE.send(body);
            },
          });
          message.ack();
        } catch {
          console.error("Research wakeup failed; durable state will be reconciled");
          message.retry({ delaySeconds: 30 });
        }
      }
    },
    async scheduled(_event, env) {
      const repository = deps.repository(env);
      if (env.ADMISSIONS_ENABLED !== "true") {
        try {
          await repository.recover(Date.now());
        } finally {
          await repository.close();
        }
        return;
      }
      await reconcile(repository, {
        send: async (body) => {
          await env.RESEARCH_QUEUE.send(body);
        },
      });
    },
  };
}

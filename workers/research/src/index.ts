import { createRuntime, consumeWakeup, reconcile, type Environment } from "@pickler/agent-runtime";
import { PostgresResearchStore } from "@pickler/infrastructure";

export interface Env extends Omit<Environment, "DATABASE_URL"> {
  HYPERDRIVE: Hyperdrive;
  RESEARCH_QUEUE: Queue<{ kind: "research-wakeup" }>;
  ADMISSIONS_ENABLED: string;
}

/** Queue/Cron only. There is intentionally no public fetch handler or Studio server. */
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (
        env.ADMISSIONS_ENABLED !== "true" ||
        !message.body ||
        message.body.kind !== "research-wakeup"
      ) {
        message.ack();
        continue;
      }
      try {
        if (!env.MODEL_BASE_URL || !env.MODEL_ID || !env.MODEL_API_KEY) {
          throw new Error("Model bindings unavailable");
        }
        const runtime = createRuntime({ ...env, DATABASE_URL: env.HYPERDRIVE.connectionString });
        await consumeWakeup(runtime.repository, runtime.execute, {
          send: async (body) => {
            await env.RESEARCH_QUEUE.send(body);
          },
        });
        message.ack();
      } catch {
        // Retry only the generic wakeup; ownership prevents replay of started investigations.
        console.error("Research wakeup failed; durable state will be reconciled");
        message.retry({ delaySeconds: 30 });
      }
    }
  },
  async scheduled(_event, env) {
    const repository = new PostgresResearchStore(env.HYPERDRIVE.connectionString);
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
} satisfies ExportedHandler<Env, { kind: "research-wakeup" }>;

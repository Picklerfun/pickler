import { createApi } from "../../api/app";
import { readEnv } from "../../config/env";
import { createContainer } from "../../composition/container";
import { consumeWakeup, reconcile, type WakeupQueue } from "./handlers";

type Bindings = Record<string, unknown> & { RESEARCH_QUEUE: WakeupQueue };
type Batch = {
  messages: { body: unknown; ack(): void; retry(options: { delaySeconds: number }): void }[];
};

async function container(bindings: Bindings) {
  const env = readEnv(
    Object.fromEntries(
      Object.entries(bindings).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  const database = new URL(env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    !/^\/pickler_cf_queue_[a-f0-9]+$/.test(database.pathname)
  ) {
    throw new Error("Background experiment requires an isolated local queue database");
  }
  return createContainer({ ...env, POLYMARKET_TRADING_RUNTIME: "off" });
}

const worker = {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    if (!["127.0.0.1", "localhost"].includes(new URL(request.url).hostname)) {
      return new Response("Local experiment only", { status: 403 });
    }
    const services = await container(env);
    try {
      return await createApi({
        ...services,
        tokens: { alpha: services.env.TENANT_ALPHA_TOKEN, beta: services.env.TENANT_BETA_TOKEN },
        notifyQueued: () => env.RESEARCH_QUEUE.send({ kind: "research-wakeup" }),
      }).fetch(request);
    } finally {
      await services.repository.close();
    }
  },
  async queue(batch: Batch, env: Bindings) {
    for (const message of batch.messages) {
      if (JSON.stringify(message.body) !== JSON.stringify({ kind: "research-wakeup" })) {
        message.ack();
        continue;
      }
      try {
        const services = await container(env);
        await consumeWakeup(services.repository, services.execute, env.RESEARCH_QUEUE);
        message.ack();
      } catch {
        // Redelivery retries acquisition/reconciliation, never a previously started run.
        console.error("Research consumer failed; wakeup will be retried");
        message.retry({ delaySeconds: 30 });
      }
    }
  },
  async scheduled(_event: unknown, env: Bindings) {
    const services = await container(env);
    await reconcile(services.repository, env.RESEARCH_QUEUE);
  },
};

export default worker;

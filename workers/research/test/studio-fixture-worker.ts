import { createPerpsRuntime, dispatchDueChecks, perpsAdmission } from "@pickler/agent-runtime";
import { PostgresPerpsRuntimeStore } from "@pickler/infrastructure";
import {
  assertControlledDatabase,
  assertControlledDatabaseUrl,
  installControlledStudioTransport,
} from "@pickler/infrastructure/testing/controlled-worker";
import { ControlledResearchStore } from "./fixture-repository.js";
import { createResearchWorker } from "../src/worker.js";
import type { Env } from "../src/index.js";
import type { ResearchMessage } from "../src/worker.js";

const repository = (env: Env & { CONTROLLED_TEST_DATABASE_ID?: string }) =>
  new ControlledResearchStore(env.DATABASE_URL, env.CONTROLLED_TEST_DATABASE_ID);
const worker = createResearchWorker({
  repository,
  runtime() {
    throw new Error("Studio acceptance never runs unrelated research protocols");
  },
  perpsRuntime: (env) => createPerpsRuntime(env, { environment: "local" }),
  perpsActions: (env) => createPerpsRuntime(env, { environment: "local" }),
});

async function guard(env: Env & { CONTROLLED_TEST_DATABASE_ID?: string }) {
  assertControlledDatabaseUrl(env.DATABASE_URL);
  if (
    env.APP_ENV !== "local" ||
    env.MODEL_API_KEY !== "controlled-test" ||
    env.PERPS_JEV_API_KEY !== "controlled-test" ||
    env.EXA_API_KEY
  ) {
    throw new Error("Studio fixture refuses real provider credentials");
  }
  const store = repository(env);
  try {
    await assertControlledDatabase(store.pool, env.CONTROLLED_TEST_DATABASE_ID);
    installControlledStudioTransport(env.CONTROLLED_TEST_DATABASE_ID!);
  } finally {
    await store.close();
  }
}

/** Compiled production cases of use, providers controlled only at their external HTTP boundary. */
export default {
  async fetch(request, env) {
    await guard(env);
    const identity = (env as Env & { CONTROLLED_TEST_DATABASE_ID: string })
      .CONTROLLED_TEST_DATABASE_ID;
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/dispatch" ||
      request.headers.get("X-Controlled-Identity") !== identity
    ) {
      return new Response(null, { status: 403 });
    }
    const { at } = await request.json<{ at: number }>();
    if (!Number.isSafeInteger(at) || Math.abs(at - Date.now()) > 3600000) {
      return new Response(null, { status: 400 });
    }
    const store = repository(env);
    try {
      const checks = await dispatchDueChecks(
        { store: new PostgresPerpsRuntimeStore(store.pool, () => at) },
        perpsAdmission(env),
        async (message) => {
          await env.RESEARCH_QUEUE.send(message);
        },
      );
      return Response.json({ checks });
    } finally {
      await store.close();
    }
  },
  async queue(batch, env, ctx) {
    await guard(env);
    await worker.queue!(batch, env, ctx);
  },
  async scheduled(event, env, ctx) {
    await guard(env);
    await worker.scheduled!(event, env, ctx);
  },
} satisfies ExportedHandler<Env, ResearchMessage>;

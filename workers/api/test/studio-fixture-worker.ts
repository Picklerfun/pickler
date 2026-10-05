import { PostgresResearchStore } from "@pickler/infrastructure";
import {
  assertControlledDatabase,
  assertControlledDatabaseUrl,
  installControlledStudioTransport,
} from "@pickler/infrastructure/testing/controlled-worker";
import { createApp } from "../src/app.js";
import { createServices } from "../src/container.js";
import type { Env } from "../src/env.js";

/** Explicit local-only entry: production routes/composition, controlled provider HTTP. */
export default {
  async fetch(request, env, ctx) {
    assertControlledDatabaseUrl(env.DATABASE_URL!);
    const repository = new PostgresResearchStore(env.DATABASE_URL!, undefined, {
      environment: "local",
    });
    let services: ReturnType<typeof createServices> | undefined;
    try {
      const identity = (env as Env & { CONTROLLED_TEST_DATABASE_ID: string })
        .CONTROLLED_TEST_DATABASE_ID;
      await assertControlledDatabase(repository.pool, identity);
      if (env.APP_ENV !== "local") {
        throw new Error("Studio fixture requires local mode");
      }
      installControlledStudioTransport(identity);
      if (new URL(request.url).pathname === "/v1/__acceptance/dispatch") {
        if (request.headers.get("X-Controlled-Identity") !== identity) {
          return new Response(null, { status: 403 });
        }
        const research = (env as Env & { CONTROLLED_RESEARCH: Fetcher }).CONTROLLED_RESEARCH;
        return research.fetch(new Request("http://controlled/dispatch", request));
      }
      services = createServices(env);
      return await createApp(services).fetch(request, env, ctx);
    } finally {
      await services?.close();
      await repository.close();
    }
  },
} satisfies ExportedHandler<Env>;

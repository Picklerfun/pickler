import { createApp } from "./app";
import { createServices } from "./container";
import type { Env } from "./env";
import { errorEnvelope, successEnvelope } from "./http/envelope";

// Preserve the legacy class and its stored data; staging does not bind it.
export { AgentLedger } from "./budget/agent-ledger";

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/health") {
      return Response.json(successEnvelope({ status: "ok" }, "/health"), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    let services: ReturnType<typeof createServices> | undefined;
    try {
      services = createServices(env);
      return await createApp(services).fetch(request, env, ctx);
    } catch {
      const path = new URL(request.url).pathname;
      console.error("API composition or transport failed");
      return Response.json(
        errorEnvelope("Service temporarily unavailable", 503, path, crypto.randomUUID()),
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } finally {
      await services?.close();
    }
  },
} satisfies ExportedHandler<Env>;

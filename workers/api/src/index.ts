import { createApp, type Services } from "./app";
import { createServices } from "./container";
import type { Env } from "./env";

export { AgentLedger } from "./budget/agent-ledger";

let app: ReturnType<typeof createApp> | undefined;
let services: Services | undefined;

export default {
  fetch(request, env, ctx) {
    // Services are built on first use, so /health answers even when bindings are missing.
    const get = () => (services ??= createServices(env));
    app ??= createApp({
      authenticate: (credentials, options) => get().authenticate(credentials, options),
      authenticateAgent: (agentRequest) => get().authenticateAgent(agentRequest),
      findWorkspace: (id) => get().findWorkspace(id),
      get agentQueries() {
        return get().agentQueries;
      },
      get budgets() {
        return get().budgets;
      },
      get profiles() {
        return get().profiles;
      },
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

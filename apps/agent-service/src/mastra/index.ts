import { MARKET_CATALOG } from "@pickler/core";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { PostgresStore } from "@mastra/pg";
import "../config/env";
import { z } from "zod";
import { setTimeout } from "node:timers/promises";
import { createContainer } from "../composition/container";
import { createApi } from "../api/app";
import { agentConfigSchema, agentResponseSchema, marketCatalogSchema } from "@pickler/api-schema";
import { plugins } from "../plugins/registry";

let pendingContainer: ReturnType<typeof createContainer> | undefined;
const getContainer = () => (pendingContainer ??= createContainer());
const input = z.object({
  preset: z.enum(["alpha", "beta"]).default("alpha"),
  marketId: z.string().regex(/^\d+$/).optional(),
  requestKey: z.string().min(1).max(100),
});
const output = z.object({
  runId: z.string(),
  status: z.string(),
  decision: z.unknown(),
  error: z.string().nullable(),
  events: z.array(z.unknown()),
});
const research = createWorkflow({ id: "research", inputSchema: input, outputSchema: output })
  .then(
    createStep({
      id: "dispatch-and-observe",
      inputSchema: input,
      outputSchema: output,
      execute: async ({ inputData }) => {
        const container = await getContainer();
        const tenantId = inputData.preset;
        const run = await container.repository.enqueue(
          { tenantId, agentId: `pickle-${tenantId}` },
          `studio:${inputData.requestKey}`,
          inputData.marketId ?? null,
          Date.now(),
        );
        const deadline = Date.now() + 360_000;
        while (Date.now() < deadline) {
          const current = await container.repository.run(tenantId, run.id);
          if (!["queued", "running"].includes(current.status)) {
            return {
              runId: run.id,
              status: current.status,
              decision: current.decision,
              error: current.error,
              events: await container.repository.events(tenantId, run.id),
            };
          }
          await setTimeout(500);
        }
        return {
          runId: run.id,
          status: "poll-via-api",
          decision: null,
          error: null,
          events: await container.repository.events(tenantId, run.id),
        };
      },
    }),
  )
  .commit();
const configurationInput = z.object({
  preset: z.enum(["alpha", "beta"]),
  expectedVersion: z.number().int().positive(),
  config: agentConfigSchema,
});
const configure = createWorkflow({
  id: "configure-agent",
  inputSchema: configurationInput,
  outputSchema: agentResponseSchema,
})
  .then(
    createStep({
      id: "save-versioned-configuration",
      inputSchema: configurationInput,
      outputSchema: agentResponseSchema,
      execute: async ({ inputData }) => {
        const { repository } = await getContainer();
        return repository.updateConfig(
          { tenantId: inputData.preset, agentId: `pickle-${inputData.preset}` },
          inputData.expectedVersion,
          inputData.config,
        );
      },
    }),
  )
  .commit();
const catalogOutput = z.object({
  marketCategories: marketCatalogSchema,
  categories: z.array(z.object({ id: z.string(), label: z.string() })),
  agents: z.array(agentResponseSchema),
  plugins: z.unknown(),
});
const catalog = createWorkflow({
  id: "lab-presets",
  inputSchema: z.object({}),
  outputSchema: catalogOutput,
})
  .then(
    createStep({
      id: "inspect-presets-and-categories",
      inputSchema: z.object({}),
      outputSchema: catalogOutput,
      execute: async () => {
        const c = await getContainer();
        return {
          marketCategories: marketCatalogSchema.parse(MARKET_CATALOG),
          categories: await c.markets.categories(AbortSignal.timeout(20000)),
          agents: [...(await c.repository.agents("alpha")), ...(await c.repository.agents("beta"))],
          plugins,
        };
      },
    }),
  )
  .commit();
const checkOutput = z.object({ result: z.unknown() });
const connections = createWorkflow({
  id: "check-connections",
  inputSchema: z.object({ runPaidCheck: z.literal(true) }),
  outputSchema: checkOutput,
})
  .then(
    createStep({
      id: "check-model-tools-and-providers",
      inputSchema: z.object({ runPaidCheck: z.literal(true) }),
      outputSchema: checkOutput,
      execute: async () => ({ result: await (await getContainer()).checkConnections() }),
    }),
  )
  .commit();
export const mastra = new Mastra({
  workflows: { research, configure, catalog, connections },
  storage: new PostgresStore({
    id: "pickler-studio",
    connectionString: process.env.DATABASE_URL,
    schemaName: "mastra",
    max: 5,
  }),
  server: {
    host: "127.0.0.1",
    port: 4111,
    cors: {
      origin: ["http://127.0.0.1:4111"],
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    },
    middleware: [
      {
        path: "*",
        handler: async (c, next) => {
          const host = c.req.header("host");
          const origin = c.req.header("origin");
          if (host !== "127.0.0.1:4111" || (origin && origin !== "http://127.0.0.1:4111")) {
            return c.json({ error: "LOCAL_OPERATOR_ONLY" }, 403);
          }
          await next();
        },
      },
    ],
    apiRoutes: [
      ...(["GET", "POST", "PUT"] as const).map((method) =>
        registerApiRoute("/pilot/*", {
          method,
          handler: async (c) => {
            const container = await getContainer();
            const api = createApi({
              ...container,
              tokens: {
                alpha: container.env.TENANT_ALPHA_TOKEN,
                beta: container.env.TENANT_BETA_TOKEN,
              },
            });
            const url = new URL(c.req.url);
            url.pathname = url.pathname.replace(/^\/pilot/, "");
            return api.fetch(new Request(url, c.req.raw));
          },
        }),
      ),
      registerApiRoute("/pilot-plugins", { method: "GET", handler: (c) => c.json({ plugins }) }),
    ],
  },
});

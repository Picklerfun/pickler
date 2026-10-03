import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildUserPrincipal, createAdviceService } from "@pickler/core";
import { PostgresAdviceStore, PostgresStudioDirectory } from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { createAdviceRunner } from "@pickler/trading/perps";
import { adviceRecommendationSchema, adviceHistorySchema } from "@pickler/api-schema";
import { createAdviceModels } from "../../../packages/agent-runtime/src/composition/advice-model.js";
import { createApp } from "../../api/src/app.js";
import { documentationServices } from "../../api/src/openapi/composition.js";
import { createResearchWorker } from "../src/worker.js";
import { adviceFixture } from "./advice-fixture.js";
import type { Env } from "../src/index.js";
function choice(options: string[], selected: string) {
  return {
    type: "choice",
    choice: selected,
    confidence: 1,
    probabilities: Object.fromEntries(options.map((v) => [v, v === selected ? 1 : 0])),
  };
}
test("controlled API → Queue → actual model adapters → PostgreSQL → shared history; duplicates never repeat calls or notify trading", async (t) => {
  const db = await createTestStore(t);
  const owner = randomUUID(),
    publicId = randomUUID(),
    user = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Maker','flow_owner')", [owner]);
  const studio = new PostgresStudioDirectory(db.pool);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
  await db.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [owner]);
  const fixture = adviceFixture(Date.now());
  fixture.job.policy = {
    ...fixture.job.policy,
    version: 2,
    deepseekBaseUrl: "https://dashscope.example/compatible-mode/v1",
  };
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at) VALUES($1,$2,'Analyst','flow_analyst','active','public',now())",
      [publicId, access.workspaceId],
    );
    await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES('flow_analyst',$1)", [
      publicId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await db.pool.query(
    "INSERT INTO pickler.agents(tenant_id,id,version,config) VALUES($1,'flow-agent',1,$2)",
    [access.tenantId, JSON.stringify(fixture.job.config)],
  );
  await db.pool.query(
    "INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request) VALUES($1,$2,$3,'flow-agent','flow','{}')",
    [publicId, access.workspaceId, access.tenantId],
  );
  const repository = new PostgresAdviceStore(db.pool);
  let mode = "ready";
  let calls = 0,
    closed = 0,
    trading = 0;
  const notifications: unknown[] = [];
  const models = createAdviceModels(
    repository,
    {
      jev: "controlled",
      baseUrl: "https://dashscope.example/compatible-mode/v1",
      model: "deepseek-chat",
      apiKey: "controlled",
    },
    async (url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      if (String(url).includes("typesafe")) {
        assert.equal(body.state.symbol, "BTC");
        return Response.json({
          model: "jev-1.13.0",
          usage: { input_tokens: 42, output_tokens: 7 },
          answers: {
            readiness: choice(
              ["READY", "INSUFFICIENT", "UNKNOWN"],
              mode === "insufficient" ? "INSUFFICIENT" : "READY",
            ),
            gap: choice(
              ["NONE", "MISSING", "CONFLICT", "UNKNOWN"],
              mode === "insufficient" ? "MISSING" : "NONE",
            ),
            scope: choice(["MATCH", "MISMATCH", "UNKNOWN"], "MATCH"),
          },
        });
      }
      assert.equal(String(url), "https://dashscope.example/compatible-mode/v1/chat/completions");
      assert.equal(init?.redirect, "manual");
      assert.doesNotMatch(
        body.messages[1].content,
        /readiness|probabilities|positions|capital|wallet/,
      );
      return Response.json({
        model: "deepseek-chat",
        usage: { prompt_tokens: 100, completion_tokens: 30 },
        choices: [
          {
            message: {
              content:
                mode === "malformed"
                  ? "not-json"
                  : JSON.stringify({
                      orientation: "short",
                      summary: "Controlled analysis",
                      reasons: ["Observed trend"],
                      risks: ["Volatility"],
                      limitations: [],
                      sourceIds: ["perpl-ticker"],
                    }),
            },
          },
        ],
      });
    },
  );
  const runner = createAdviceRunner({
    repository,
    models,
    now: Date.now,
    data: async () => fixture.evidence,
  });
  const services = documentationServices({});
  services.authenticate = async (credentials) => ({
    principal: buildUserPrincipal({
      user: { id: credentials.bearerToken === "other" ? randomUUID() : user },
    }),
    workspace: null,
  });
  services.advice = {
    authenticate: services.authenticate,
    service: createAdviceService(repository, { enabled: true, policy: fixture.job.policy }),
    notify: async () => {
      notifications.push({ kind: "advice-wakeup" });
    },
  };
  const app = createApp(services);
  const headers = {
    authorization: "Bearer user",
    "content-type": "application/json",
    "idempotency-key": "flow",
  };
  const response = await app.request(
    `/v1/agent-advice/agents/${publicId}/recommendations`,
    { method: "POST", headers, body: JSON.stringify({ symbol: "BTC" }) },
    { APP_ENV: "test" },
  );
  assert.equal(response.status, 202);
  const id = (await response.json()).data.id;
  const worker = createResearchWorker({
    repository: () => db,
    runtime: () => {
      throw new Error("Research must not run");
    },
    adviceRuntime: () => ({
      repository,
      execute: runner,
      close: async () => {
        closed++;
      },
    }),
  });
  const env = {
    ADVICE_ENABLED: "true",
    ADMISSIONS_ENABLED: "false",
    RESEARCH_QUEUE: {
      send: async (body: unknown) => {
        notifications.push(body);
      },
    },
    TRADING_QUEUE: {
      send: async () => {
        trading++;
      },
    },
  } as unknown as Env;
  for (let i = 0; i < 2; i++) {
    await worker.queue!(
      {
        messages: [
          {
            body: { kind: "advice-wakeup" },
            ack: () => {},
            retry: () => assert.fail("Unexpected retry"),
          },
        ],
      } as never,
      env,
      {} as never,
    );
  }
  assert.equal(calls, 2);
  assert.equal(closed, 2);
  assert.equal(trading, 0);
  const read = await app.request(
    `/v1/agent-advice/recommendations/${id}`,
    { headers: { authorization: "Bearer other" } },
    { APP_ENV: "test" },
  );
  const result = adviceRecommendationSchema.parse((await read.json()).data);
  assert.equal(result.status, "completed");
  assert.equal(result.result!.orientation, "short");
  const history = await app.request(
    `/v1/agent-advice/agents/${publicId}/recommendations`,
    { headers },
    { APP_ENV: "test" },
  );
  assert.equal(adviceHistorySchema.parse((await history.json()).data).items.length, 1);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM pickler.advice_calls WHERE status='completed'",
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT provider FROM pickler.advice_calls WHERE job_id=$1 AND lane='deepseek'",
        [id],
      )
    ).rows[0].provider,
    "https://dashscope.example",
  );
  assert.equal(
    (await db.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_accounts")).rows[0].n,
    0,
  );
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM pickler.runs")).rows[0].n, 0);
  for (const scenario of ["insufficient", "malformed"]) {
    mode = scenario;
    const previousCalls = calls;
    const accepted = await app.request(
      `/v1/agent-advice/agents/${publicId}/recommendations`,
      {
        method: "POST",
        headers: { ...headers, "idempotency-key": scenario },
        body: JSON.stringify({ symbol: "BTC" }),
      },
      { APP_ENV: "test" },
    );
    assert.equal(accepted.status, 202);
    const newId = (await accepted.json()).data.id;
    await worker.queue!(
      {
        messages: [
          {
            body: { kind: "advice-wakeup" },
            ack: () => {},
            retry: () => assert.fail("No paid retry"),
          },
        ],
      } as never,
      env,
      {} as never,
    );
    const job = await repository.get(newId);
    assert.equal(job.status, scenario === "insufficient" ? "completed" : "failed");
    assert.equal(calls - previousCalls, scenario === "insufficient" ? 1 : 2);
    if (scenario === "insufficient") {
      assert.equal((job.result as { orientation: string }).orientation, "wait");
    } else {
      assert.equal(job.result, null);
      assert.equal(
        (
          await db.pool.query(
            "SELECT status FROM pickler.advice_calls WHERE job_id=$1 AND lane='deepseek'",
            [newId],
          )
        ).rows[0].status,
        "completed",
      );
      await worker.queue!(
        {
          messages: [
            {
              body: { kind: "advice-wakeup" },
              ack: () => {},
              retry: () => assert.fail("No retry"),
            },
          ],
        } as never,
        env,
        {} as never,
      );
      assert.equal(calls - previousCalls, 2);
    }
  }
});

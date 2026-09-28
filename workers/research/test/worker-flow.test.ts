import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withFixtureUserCleanup } from "./fixture-user-cleanup.js";
import { assertControlledDatabase, assertControlledDatabaseUrl } from "./fixture-isolation.js";

const enabled = process.env.TEST_WORKERS_URL !== undefined;
test(
  "compiled web/API/Queue persist controlled outcomes for isolated Supabase users",
  { skip: !enabled },
  async () => {
    const base = process.env.TEST_WORKERS_URL!;
    assert.equal(new URL(base).hostname, "127.0.0.1");
    const status = JSON.parse(readFileSync(process.env.SUPABASE_LOCAL_STATUS_FILE!, "utf8"));
    assert.equal(new URL(status.API_URL).hostname, "127.0.0.1");
    assert.equal(new URL(status.API_URL).port, "55521");
    assertControlledDatabaseUrl(status.DB_URL);
    const db = new Pool({ connectionString: status.DB_URL, max: 1 });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const actors: { id: string; token: string; refresh: string; agent: string }[] = [];
    const request = async (
      path: string,
      token?: string,
      body?: unknown,
      method?: string,
      key = randomUUID(),
    ) => {
      const response = await fetch(base + "/api/v1" + path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    await withFixtureUserCleanup(db, async (trackCreatedUser) => {
      await assertControlledDatabase(db, process.env.CONTROLLED_TEST_DATABASE_ID);
      assert.equal((await request("/studio/agents")).status, 401);
      for (const index of [0, 1]) {
        const email = `direct-${suffix}-${index}@example.com`;
        const password = randomUUID() + "aA1!";
        const created = await fetch(status.API_URL + "/auth/v1/admin/users", {
          method: "POST",
          headers: {
            apikey: status.SERVICE_ROLE_KEY,
            Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        assert.equal(created.status, 200);
        const user = await created.json();
        trackCreatedUser(user.id);
        const login = await fetch(status.API_URL + "/auth/v1/token?grant_type=password", {
          method: "POST",
          headers: { apikey: status.ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        assert.equal(login.status, 200);
        const session = await login.json();
        const token = session.access_token;
        assert.equal(
          (
            await request("/profile", token, {
              display_name: "Controlled worker test",
              handle: `d${suffix}${index}`,
            })
          ).status,
          201,
        );
        assert.equal((await request("/studio/me", token)).body.enabled, false);
        const config = (await request("/studio/options", token)).body.defaults;
        Object.assign(config, {
          marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
          plugins: { version: 1, enabled: ["polymarket", "exa"] },
        });
        // An agent is created with its wallet, or not at all: seed the wallet this person owns,
        // with the approved policy ids `confirmPolicies` would have recorded, so the create
        // request below has one to link. The request itself carries only the wallet's id — the
        // server is the only source of which policies it links.
        const walletId = `wallet-${randomUUID().replaceAll("-", "")}`;
        await db.query(
          `INSERT INTO wallets.wallets
             (user_id, wallet_id, sub_organization_id, kind, name, approved_policy_ids)
           VALUES ($1, $2, $3, 'agent', 'Controlled agent', $4)`,
          [user.id, walletId, `sub-${randomUUID().replaceAll("-", "")}`, ["p1", "p2"]],
        );
        const body = {
          name: "Controlled agent",
          handle: `a${suffix}${index}`,
          config,
          profile: {
            accent: "lime",
            blurb: "",
            venue: "predictions",
            vibe: "",
            voice: "",
            decides: "",
            wrong: "",
            xHandle: null,
          },
          wallet: { walletId },
        };
        assert.equal((await request("/studio/agents", token, body)).status, 403);
        await db.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
          user.id,
        ]);
        const key = randomUUID();
        const agent = await request("/studio/agents", token, body, "POST", key);
        assert.equal(agent.status, 201);
        assert.equal(
          (await request("/studio/agents", token, body, "POST", key)).body.id,
          agent.body.id,
        );
        assert.equal(agent.body.scheduleEnabled, false);
        actors.push({ id: user.id, token, refresh: session.refresh_token, agent: agent.body.id });
      }
      for (const [index, scenario] of ["abstain", "trade", "failure"].entries()) {
        const actor = actors[index % 2]!;
        const key = randomUUID();
        const queued = await request(
          `/studio/agents/${actor.agent}/runs`,
          actor.token,
          { marketId: String(index + 1) },
          "POST",
          key,
        );
        assert.equal(queued.status, 202);
        const runId = queued.body.runId;
        assert.equal(
          (
            await request(
              `/studio/agents/${actor.agent}/runs`,
              actor.token,
              { marketId: String(index + 1) },
              "POST",
              key,
            )
          ).body.runId,
          runId,
        );
        assert.equal(
          (await request(`/studio/runs/${runId}`, actors[(index + 1) % 2]!.token)).status,
          404,
        );
        let result;
        const deadline = Date.now() + 30000;
        do {
          const polled = await request(`/studio/runs/${runId}`, actor.token);
          assert.equal(polled.status, 200);
          assert.match(polled.headers.get("cache-control")!, /no-store/);
          result = polled.body;
          if (["completed", "failed"].includes(result.status)) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        assert.equal(result.status, scenario === "failure" ? "failed" : "completed");
        if (scenario === "failure") {
          assert.equal(result.decision, null);
        } else {
          assert.equal(result.decision.action, scenario.toUpperCase());
        }
        const events = await request(`/studio/runs/${runId}/events`, actor.token);
        assert.equal(events.status, 200);
        assert.ok(events.body.events.length > 0);
        assert.equal(
          (await request(`/studio/runs/${runId}/events`, actors[(index + 1) % 2]!.token)).status,
          404,
        );
        console.log(
          JSON.stringify({
            scenario,
            runId,
            status: result.status,
            action: result.decision?.action ?? null,
            events: events.body.events.length,
          }),
        );
      }
      for (const actor of actors) {
        const refreshed = await fetch(status.API_URL + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          headers: { apikey: status.ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: actor.refresh }),
        });
        assert.equal(refreshed.status, 200);
        const session = await refreshed.json();
        assert.equal((await request("/studio/me", session.access_token)).status, 200);
        const logout = await fetch(status.API_URL + "/auth/v1/logout", {
          method: "POST",
          headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        });
        assert.equal(logout.status, 204);
        await db.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
          actor.id,
        ]);
        assert.equal(
          (await request(`/studio/agents/${actor.agent}/runs`, session.access_token, {})).status,
          403,
        );
      }
    });
  },
);

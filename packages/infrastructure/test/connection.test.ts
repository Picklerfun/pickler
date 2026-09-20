import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { databasePoolConfig } from "../src/persistence/connection.js";
import { PostgresResearchStore } from "../src/persistence/research-store.js";

const local =
  process.env.TEST_DATABASE_URL ??
  "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
const remote =
  "postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

test("deployed connections enforce TLS and reject overrides without disclosing credentials", () => {
  const config = databasePoolConfig(remote, { environment: "staging" });
  assert.equal(config.max, 2);
  assert.equal(config.connectionTimeoutMillis, 10_000);
  assert.equal(config.statement_timeout, 10_000);
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    servername: "aws-0-us-east-1.pooler.supabase.com",
  });
  for (const url of [
    remote + "?sslmode=disable",
    remote.replace(":5432", ":6543"),
    local,
    "password-not-a-url",
  ]) {
    assert.throws(
      () => databasePoolConfig(url, { environment: "staging" }),
      (error: Error) => {
        assert.ok(!error.message.includes("secret"));
        assert.ok(!error.message.includes("password-not-a-url"));
        return true;
      },
    );
  }
  assert.throws(() => databasePoolConfig(remote, { environment: "local" }), /loopback/);
  assert.equal(databasePoolConfig(local, { environment: "local" }).ssl, false);
});

test("endpoint query overrides cannot change the host or port validated by the guard", () => {
  const loopback = "postgresql://user:secret@127.0.0.1:55432/pickler";
  const overrides = [
    { query: "host=remote.example", host: "remote.example" },
    { query: "host=%2Ftmp", host: "/tmp" },
    { query: "host=%3A%3A1", host: "::1" },
    { query: "%68ost=remote.example", host: "remote.example" },
    { query: "host=127.0.0.1&host=remote.example", host: "remote.example" },
    { query: "host=", host: "127.0.0.1" },
    { query: "port=6543", port: 6543 },
    { query: "%70ort=6543", port: 6543 },
    { query: "port=5432&port=6543", port: 6543 },
    { query: "port=6543suffix", port: 6543 },
    { query: "port=", port: 55432 },
    { query: "host=remote.example&port=6543", host: "remote.example", port: 6543 },
  ];

  for (const { query, host, port } of overrides) {
    // Construction parses pg's effective endpoint without opening a socket.
    const client = new pg.Client({ connectionString: `${loopback}?${query}` });
    assert.equal(client.host, host ?? "127.0.0.1", query);
    assert.equal(client.port, port ?? 55432, query);

    for (const [url, environment] of [
      [loopback, "local"],
      [remote, "staging"],
    ] as const) {
      assert.throws(
        () => databasePoolConfig(`${url}?${query}`, { environment }),
        /endpoint in the URL authority/,
        query,
      );
    }
  }
});

test("encoded hostnames cannot turn a staging endpoint into a Unix socket", () => {
  const url = remote.replace("aws-0-us-east-1", "%2Ftmp%2Faws-0-us-east-1");
  const client = new pg.Client({ connectionString: url });
  assert.equal(client.host, "/tmp/aws-0-us-east-1.pooler.supabase.com");
  assert.throws(() => databasePoolConfig(url, { environment: "staging" }), /unencoded host/);
});

test("deployed query parameters cannot override connection limits or inject other pg options", () => {
  for (const query of [
    "statement_timeout=0",
    "%73tatement_timeout=0",
    "connectionTimeoutMillis=0",
    "connect_timeout=0",
    "query_timeout=0",
    "options=-c%20statement_timeout%3D0",
    "user=other",
    "password=other",
    "hostaddr=remote.example",
    "connectionString=postgresql%3A%2F%2Fremote.example%2Fpostgres",
    "application_name=test&statement_timeout=0",
  ]) {
    for (const environment of ["staging", "local"]) {
      assert.throws(
        () => databasePoolConfig(`${remote}?${query}`, { environment }),
        /only supports the application_name/,
        query,
      );
    }
  }

  const legacyUrl = `${remote}?statement_timeout=0&host=remote.example`;
  assert.equal(databasePoolConfig(legacyUrl).connectionString, legacyUrl);
  assert.equal(databasePoolConfig(legacyUrl).max, 5);
});

test("accepted URLs retain their effective pg endpoint, TLS and safe query options", () => {
  for (const [host, environment, port] of [
    ["127.0.0.1", "local", 55432],
    ["localhost", "local", 5432],
    ["[::1]", "local", 5432],
    ["aws-0-us-east-1.pooler.supabase.com", "staging", 5432],
  ] as const) {
    const url = `postgresql://user:secret@${host}:${port}/postgres?application_name=connection-test`;
    const config = databasePoolConfig(url, { environment, ca: "test-ca" });
    const client = new pg.Client(config);
    assert.equal(client.host, host);
    assert.equal(client.port, port);
    assert.equal(client.database, "postgres");
    assert.deepEqual(
      client.ssl,
      environment === "local"
        ? false
        : {
            rejectUnauthorized: true,
            servername: host,
            ca: "test-ca",
          },
    );
    assert.equal(Reflect.get(client, "connectionParameters").application_name, "connection-test");
    assert.equal(Reflect.get(client, "connectionParameters").statement_timeout, 10_000);
    assert.equal(Reflect.get(client, "connectionParameters").connect_timeout, 10);
  }
});

test("invocation pools are independent, allow a second query and close after failures", async () => {
  const first = new PostgresResearchStore(local, undefined, { environment: "local" });
  const second = new PostgresResearchStore(local, undefined, { environment: "local" });
  try {
    assert.notEqual(first.pool, second.pool);
    const held = await first.pool.connect();
    try {
      await held.query("BEGIN");
      const result = await first.pool.query("SELECT 1 AS alive");
      assert.equal(result.rows[0].alive, 1);
      assert.equal(first.pool.totalCount, 2);
      await assert.rejects(second.pool.query("SELECT missing_column"));
      assert.equal((await second.pool.query("SELECT 1 AS alive")).rows[0].alive, 1);
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
  assert.equal(first.pool.totalCount, 0);
  assert.equal(second.pool.totalCount, 0);
});

test("a lease renews using the second connection while the first is occupied", async (t) => {
  const { createTestStore } = await import("./database.js");
  const repository = await createTestStore(t);
  repository.pool.options.max = 2;
  const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
  const agent = await repository.agent(scope);
  await repository.updateConfig(scope, agent.version, { ...agent.config, categoryIds: ["1"] });
  await repository.enqueue(scope, "two-connection-lease", "1", Date.now());
  const run = (await repository.claim(Date.now()))!;
  const held = await repository.pool.connect();
  try {
    await held.query("BEGIN");
    await repository.renew(run);
    await repository.assertOwnership(run);
    assert.equal(repository.pool.totalCount, 2);
  } finally {
    await held.query("ROLLBACK");
    held.release();
  }
});

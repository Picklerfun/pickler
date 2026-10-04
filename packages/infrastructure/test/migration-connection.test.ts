import assert from "node:assert/strict";
import test from "node:test";
import { migrationPoolConfig } from "../src/persistence/migration-connection.js";

test("operator migrations retain session TLS and reject endpoint/TLS overrides", () => {
  const url =
    "postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
  const config = migrationPoolConfig(url, "certificate\\nline");
  assert.equal(config.max, 1);
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    servername: "aws-0-us-east-1.pooler.supabase.com",
    ca: "certificate\nline",
  });
  for (const invalid of [
    url.replace(":5432", ":6543"),
    url + "?sslmode=disable",
    url + "?host=attacker.example",
    "secret-not-a-url",
    url.replace("aws-0-us-east-1.pooler.supabase.com", "%2Ftmp"),
  ]) {
    assert.throws(
      () => migrationPoolConfig(invalid, "certificate"),
      (error: Error) => {
        assert.ok(!error.message.includes("secret"));
        return true;
      },
    );
  }
  assert.throws(() => migrationPoolConfig(url), /CA_CERT/);
  assert.equal(migrationPoolConfig("postgresql://user:secret@127.0.0.1:55432/test").ssl, false);
  assert.equal(
    migrationPoolConfig(
      "postgresql://user:secret@db.project.supabase.co:5432/postgres",
      "certificate",
    ).max,
    1,
  );
});

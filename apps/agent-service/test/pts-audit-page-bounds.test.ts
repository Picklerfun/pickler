import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  exportPerpsAudit,
  exportPerpsAuditParts,
  PostgresPerpsStudyStore,
  type PerpsAuditSourceRevision,
} from "@pickler/infrastructure/perps-lab";
import type { PerpsPtsIntradayConfig } from "@pickler/trading/pts";
import { fastEvidence, fastTime } from "@pickler/trading/testing/pts-intraday-fast";
import { digest } from "../src/pts-study/files.js";

for (const kind of ["round", "event"] as const) {
  test(kind + " native fingerprints never evaluate bodies outside the selected page", async (t) => {
    const db = await createTestStore(t);
    const config = JSON.parse(
      await readFile(
        new URL("../src/pts-study/pts-intraday-fast-template.json", import.meta.url),
        "utf8",
      ),
    ) as PerpsPtsIntradayConfig;
    config.tenantId = "alpha";
    const study = new PostgresPerpsStudyStore(db.pool);
    await study.initialize(config, { commit: "controlled-page-bounds" });
    const id = (
      await db.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
        config.sessionId,
      ])
    ).rows[0]!.id;
    const evidence = fastEvidence(fastTime, false, "0.40", digest);
    for (let index = 31; index >= 0; index--) {
      const key = "round-" + String(index).padStart(3, "0");
      await db.pool.query(
        "INSERT INTO pickler.perps_study_rounds(study_id,key,document) VALUES($1,$2,$3)",
        [
          id,
          key,
          {
            key,
            slot: index,
            status: "completed",
            executionStatus: "complete",
            createdAt: fastTime,
            finishedAt: fastTime,
            evidence,
            proposals: {},
            calls: {},
            accounts: {},
          },
        ],
      );
      await db.pool.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          "event-" + String(index).padStart(3, "0"),
          fastTime + (31 - index) * 1000,
          "controlled",
          { value: index },
        ],
      );
    }
    const before = await exportPerpsAudit(db.pool, config);
    const client = await db.pool.connect();
    try {
      // Force the unordered scan/sort counterexample. This changes only the disposable fixture.
      await client.query("SET enable_indexscan=off");
      await client.query("SET enable_bitmapscan=off");
      await client.query(`CREATE FUNCTION pg_temp.page_fingerprint(value bytea) RETURNS bytea
      LANGUAGE plpgsql IMMUTABLE COST 1 AS $$
      BEGIN
        IF NOT (current_setting('pts_test.allowed_keys')::jsonb ?
          (convert_from(value,'UTF8')::jsonb->>'key')) THEN
          RAISE EXCEPTION 'OUT_OF_PAGE_FINGERPRINT';
        END IF;
        RETURN sha256(value);
      END $$`);
      const pages: { kind: string; keys: string[] }[] = [];
      const boundedPool = {
        connect: async () => ({
          query: async (sql: string, values?: unknown[]) => {
            const target = kind === "round" ? "perps_study_rounds" : "perps_study_events";
            if (sql.includes(target) && sql.includes("sha256(")) {
              const keys = (
                await client.query(
                  kind === "round"
                    ? `SELECT key FROM pickler.perps_study_rounds
                     WHERE study_id=$1 AND ($2::text IS NULL OR key>$2)
                     ORDER BY key LIMIT 1`
                    : `SELECT key FROM pickler.perps_study_events
                     WHERE study_id=$1 AND ($2::bigint IS NULL OR (at,key)>($2,$3))
                     ORDER BY at::double precision,key LIMIT 16`,
                  values,
                )
              ).rows.map((row) => row.key as string);
              pages.push({ kind, keys });
              await client.query("SELECT set_config('pts_test.allowed_keys',$1,true)", [
                JSON.stringify(keys),
              ]);
              return client.query(sql.replaceAll("sha256(", "pg_temp.page_fingerprint("), values);
            }
            return client.query(sql, values);
          },
          release: () => {},
        }),
      } as unknown as Pool;
      const revisions: PerpsAuditSourceRevision[] = [];
      const captured: unknown[] = [];

      const result = await exportPerpsAuditParts(
        boundedPool,
        config,
        async (part) => {
          captured.push(part);
        },
        {
          reuse: async (revision) => {
            revisions.push(revision);
            return false;
          },
        },
      );

      assert.equal(result.roundsChecked, 32);
      assert.equal(result.eventsChecked, 32);
      assert.equal(result.roundsFetched, 32);
      assert.equal(result.eventsFetched, 32);
      const selected = revisions.filter((revision) => revision.kind === kind);
      assert.equal(new Set(selected.map((revision) => revision.key)).size, 32);
      assert.equal(
        pages.reduce((total, page) => total + page.keys.length, 0),
        32,
      );
      assert.ok(pages.every((page) => page.keys.length <= (kind === "round" ? 1 : 16)));
      const fetched = captured.filter((part) => (part as { kind: string }).kind === kind);
      assert.deepEqual(
        fetched.map((part) => (part as { value: unknown }).value),
        kind === "round" ? before.study.rounds : before.study.events,
      );
      for (const revision of revisions) {
        const expected = (
          await client.query(
            revision.kind === "round"
              ? "SELECT encode(sha256(convert_to(document::text,'UTF8')),'hex') AS sha256 FROM pickler.perps_study_rounds WHERE study_id=$1 AND key=$2"
              : `SELECT encode(sha256(convert_to(jsonb_build_object(
                 'key',key,'at',at::double precision,'kind',kind,'data',data
               )::text,'UTF8')),'hex') AS sha256
               FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2`,
            [id, revision.key],
          )
        ).rows[0]!.sha256;
        assert.equal(revision.sha256, expected);
      }
    } finally {
      client.release();
    }
    assert.deepEqual(await exportPerpsAudit(db.pool, config), before);
  });
}

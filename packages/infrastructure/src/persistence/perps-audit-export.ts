import type { Pool } from "pg";
import { PilotError } from "@pickler/core";
import type { PerpsStudyScope, PerpsStudyView, PerpsStudyMap } from "@pickler/trading/evaluation";
import { perpsStrategies } from "@pickler/trading/evaluation";
import type { PerpsPaperView } from "@pickler/trading/perps";

/** A consistent read-only snapshot. Unlike paper.view(), this never recovers expired attempts. */
export async function exportPerpsAudit(pool: Pool, scope: PerpsStudyScope) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const study = await client.query(
      `SELECT id, document FROM pickler.perps_studies
       WHERE tenant_id=$1 AND session_id=$2 AND network=$3`,
      [scope.tenantId, scope.sessionId, scope.network],
    );
    if (study.rows.length !== 1) {
      throw new PilotError("NOT_FOUND", "Scoped study not found");
    }
    const { id, document: record } = study.rows[0];
    const rounds = await client.query(
      "SELECT document FROM pickler.perps_study_rounds WHERE study_id=$1 ORDER BY key",
      [id],
    );
    const events = await client.query(
      "SELECT key,at::double precision AS at,kind,data FROM pickler.perps_study_events WHERE study_id=$1 ORDER BY at,key",
      [id],
    );
    const view: PerpsStudyView = {
      record,
      rounds: rounds.rows.map((r) => r.document),
      events: events.rows,
    };
    const accounts = {} as PerpsStudyMap<PerpsPaperView>;
    for (const strategy of perpsStrategies(record.config)) {
      const result = await client.query(
        `SELECT id,document FROM pickler.perps_paper_accounts
         WHERE tenant_id=$1 AND session_id=$2 AND network=$3 AND agent_id=$4`,
        [scope.tenantId, scope.sessionId, scope.network, record.agentIds[strategy]],
      );
      if (result.rows.length !== 1) {
        throw new PilotError("NOT_FOUND", "Scoped paper account not found");
      }
      const account = result.rows[0];
      const attempts = await client.query(
        "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 ORDER BY key",
        [account.id],
      );
      const movements = await client.query(
        "SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1 ORDER BY key",
        [account.id],
      );
      accounts[strategy] = {
        account: account.document,
        attempts: attempts.rows.map((r) => r.document),
        movements: movements.rows.map((r) => r.document),
      };
    }
    await client.query("COMMIT");
    return { study: view, accounts };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

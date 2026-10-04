import { PilotError, type Scope } from "@pickler/core";
import type { PoolClient } from "pg";

/** Internal SQL fragments use the runtime-agent alias r, never caller-provided identifiers. */
export const PERPS_MANUAL_READY_SQL = `EXISTS (
  SELECT 1 FROM pickler.perps_checks preparation
  WHERE preparation.tenant_id = r.tenant_id AND preparation.agent_id = r.id
    AND preparation.config_version = r.version AND preparation.trigger = 'manual'
    AND preparation.status = 'finished' AND preparation.outcome NOT IN ('failed','skipped','system')
    AND preparation.decision->>'protocol' = 'studio-perps-check-v2'
    AND preparation.decision->>'incomplete' = 'false'
)`;

export const PERPS_HOURLY_READY_SQL = `r.schedule_enabled AND NOT r.paused
  AND jsonb_typeof(r.config->'perpl') = 'object'
  AND EXISTS (
    SELECT 1 FROM pickler.product_agents mapping
    JOIN agents.agents product ON product.id = mapping.product_agent_id
    WHERE mapping.tenant_id = r.tenant_id AND mapping.runtime_agent_id = r.id
      AND product.visibility = 'public' AND product.killed_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM pickler.metadata checked
    WHERE checked.key = 'connections_checked:' || r.tenant_id || ':' || r.id || ':' || r.version
      AND checked.value = 'true'
  )
  AND ${PERPS_MANUAL_READY_SQL}`;

/** Caller holds the runtime-agent row lock, also used by setup and schedule writes. */
export async function assertPerpsHourlyReady(db: PoolClient, scope: Scope): Promise<void> {
  const result = await db.query(
    `SELECT 1 FROM pickler.agents r WHERE r.tenant_id = $1 AND r.id = $2
      AND ${PERPS_HOURLY_READY_SQL}`,
    [scope.tenantId, scope.agentId],
  );
  if (!result.rowCount) {
    throw new PilotError(
      "NOT_READY",
      "Hourly Perpl execution requires enabled, prepared scheduling",
    );
  }
}

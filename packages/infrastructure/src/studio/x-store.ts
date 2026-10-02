import type { Pool, PoolClient } from "pg";
import {
  PilotError,
  XHandleTakenError,
  type XAccount,
  type XChallenge,
  type XStore,
} from "@pickler/core";

/** The unique indexes that mean another agent already holds this X account or handle (D6). */
const TAKEN = new Set([
  "x_accounts_x_user_id_key",
  "x_accounts_handle_key",
  "agent_profiles_x_handle_key",
]);

const CHALLENGE_COLUMNS = `handle, code, created_at AS "createdAt", expires_at AS "expiresAt",
  last_checked_at AS "lastCheckedAt"`;

/** Connect X's challenges and verified accounts (studio-draft-dashboard-v1 D4, D6, §5). */
export class PostgresXStore implements XStore {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async saveChallenge(
    agentId: string,
    challenge: { handle: string; code: string; expiresAt: Date },
    intervalMs: number,
  ): Promise<XChallenge | null> {
    // A new challenge is a new start for which posts count (its creation time bounds them), but
    // not for the check limit: `last_checked_at` is the agent's and stays. One statement: the
    // conflict's row lock serializes concurrent issues, and one made within the interval of the
    // previous matches nothing and writes nothing.
    const { rows } = await this.pool.query<XChallenge>(
      `INSERT INTO agents.x_challenges (agent_id, handle, code, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id) DO UPDATE SET handle = excluded.handle, code = excluded.code,
         created_at = now(), expires_at = excluded.expires_at
       WHERE agents.x_challenges.created_at
         <= now() - $5::double precision * interval '1 millisecond'
       RETURNING ${CHALLENGE_COLUMNS}`,
      [agentId, challenge.handle, challenge.code, challenge.expiresAt, intervalMs],
    );
    return rows[0] ?? null;
  }
  async challenge(agentId: string): Promise<XChallenge | null> {
    const { rows } = await this.pool.query<XChallenge>(
      `SELECT ${CHALLENGE_COLUMNS} FROM agents.x_challenges WHERE agent_id = $1`,
      [agentId],
    );
    return rows[0] ?? null;
  }
  async claimCheck(agentId: string, at: Date, intervalMs: number): Promise<boolean> {
    // One statement: the row lock the UPDATE takes serializes concurrent checks, and the second
    // sees the first's time and matches nothing.
    const { rowCount } = await this.pool.query(
      `UPDATE agents.x_challenges SET last_checked_at = $2
       WHERE agent_id = $1
         AND (
           last_checked_at IS NULL
           OR last_checked_at <= $2::timestamptz - $3::double precision * interval '1 millisecond'
         )
       RETURNING 1`,
      [agentId, at, intervalMs],
    );
    return rowCount === 1;
  }
  async connect(
    agentId: string,
    account: { xUserId: string; handle: string; postId: string; at: Date },
  ): Promise<void> {
    try {
      await this.transaction(async (client) => {
        await client.query(
          `INSERT INTO agents.x_accounts (agent_id, x_user_id, handle, verified_at, verification_post_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [agentId, account.xUserId, account.handle, account.at, account.postId],
        );
        // The profile keeps the "@" form its format check requires; its unique index is the
        // second guard on the handle.
        await client.query("UPDATE agents.agent_profiles SET x_handle = $2 WHERE agent_id = $1", [
          agentId,
          `@${account.handle}`,
        ]);
        await client.query("DELETE FROM agents.x_challenges WHERE agent_id = $1", [agentId]);
      });
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === "23505" && TAKEN.has(constraint ?? "")) {
        throw new XHandleTakenError();
      }
      if (code === "23505" && constraint === "x_accounts_pkey") {
        throw new PilotError("X_ALREADY_CONNECTED", "This agent already has an X account");
      }
      throw error;
    }
  }
  async account(agentId: string): Promise<XAccount | null> {
    const { rows } = await this.pool.query<XAccount>(
      `SELECT x_user_id AS "xUserId", handle, verified_at AS "verifiedAt",
         verification_post_id AS "postId"
       FROM agents.x_accounts WHERE agent_id = $1`,
      [agentId],
    );
    return rows[0] ?? null;
  }
  async disconnect(agentId: string): Promise<void> {
    await this.transaction(async (client) => {
      // The same row lock publish takes, so a disconnect and a publish never interleave.
      const { rows } = await client.query<{ visibility: string }>(
        "SELECT visibility::text FROM agents.agents WHERE id = $1 FOR UPDATE",
        [agentId],
      );
      if (rows[0]?.visibility === "public") {
        throw new PilotError("X_ON_PUBLIC_AGENT", "A public agent keeps its X handle");
      }
      await client.query("DELETE FROM agents.x_accounts WHERE agent_id = $1", [agentId]);
      await client.query("DELETE FROM agents.x_challenges WHERE agent_id = $1", [agentId]);
      await client.query("UPDATE agents.agent_profiles SET x_handle = NULL WHERE agent_id = $1", [
        agentId,
      ]);
    });
  }
  async handleTaken(handle: string, exceptAgentId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ taken: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM agents.x_accounts WHERE lower(handle) = lower($1) AND agent_id <> $2
       ) OR EXISTS (
         SELECT 1 FROM agents.agent_profiles WHERE lower(x_handle) = lower('@' || $1) AND agent_id <> $2
       ) AS taken`,
      [handle, exceptAgentId],
    );
    return rows[0]!.taken;
  }
}

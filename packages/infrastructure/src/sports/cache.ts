import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PilotError } from "@pickler/core";

export interface PublicDataCache {
  get(key: string): Promise<{ value: unknown; retrievedAt: string } | null>;
  put(key: string, value: unknown, retrievedAt: string, ttlMs: number): Promise<void>;
  reserve(provider: string, credential: string, signal: AbortSignal): Promise<void>;
}

/** Public data only. Callers must authorize before every access. Quotas are shared per key. */
export class PostgresPublicDataCache implements PublicDataCache {
  constructor(private readonly pool: Pool) {}
  async get(key: string) {
    const result = await this.pool.query<{ value: unknown; retrieved_at: string }>(
      `SELECT value, retrieved_at FROM pickler.provider_cache WHERE key = $1 AND expires_at > floor(extract(epoch FROM clock_timestamp()) * 1000)`,
      [key],
    );
    const row = result.rows[0];
    return row ? { value: row.value, retrievedAt: row.retrieved_at } : null;
  }
  async put(key: string, value: unknown, retrievedAt: string, ttlMs: number) {
    await this.pool.query(
      `INSERT INTO pickler.provider_cache (key, value, retrieved_at, expires_at)
      VALUES ($1, $2::jsonb, $3, floor(extract(epoch FROM clock_timestamp()) * 1000) + $4)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, retrieved_at = excluded.retrieved_at, expires_at = excluded.expires_at`,
      [key, JSON.stringify(value), retrievedAt, ttlMs],
    );
  }
  async reserve(provider: string, credential: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = createHash("sha256")
      .update(provider + credential)
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      const window = provider === "balldontlie" ? "minute" : "month";
      const cap = provider === "balldontlie" ? 5 : 500;
      const result = await client.query<{ used: number }>(
        `INSERT INTO pickler.provider_quotas (key, window_start, used)
        VALUES ($1, date_trunc($2, clock_timestamp() AT TIME ZONE 'UTC')::text, 1)
        ON CONFLICT (key, window_start) DO UPDATE SET used = provider_quotas.used + 1
        WHERE provider_quotas.used < $3 RETURNING used`,
        [key, window, cap],
      );
      if (!result.rows.length) {
        throw new PilotError("PROVIDER_QUOTA", "Shared free provider quota exhausted");
      }
      signal.throwIfAborted();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

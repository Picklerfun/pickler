import type { Pool } from "pg";
import {
  DataSourceUnavailableError,
  type CreateProfileResult,
  type Profile,
  type ProfileRepository,
} from "@pickler/core";
import { readRows } from "./data-source.js";

/**
 * identity.profiles and identity.handles over the API's pool. Handles are shared with agents, so
 * availability and creation go through identity.handle_available() and identity.create_profile()
 * (drizzle/0006_product_functions_and_grants.sql), which register the handle and the profile in
 * one transaction — the same functions the Supabase adapter called through PostgREST.
 */
export class PostgresProfileRepository implements ProfileRepository {
  constructor(private readonly pool: Pool) {}

  async findByUserId(userId: string): Promise<Profile | null> {
    const rows = await readRows<Profile>(
      this.pool,
      "identity.profiles.findByUserId",
      `SELECT user_id AS "userId", display_name AS "displayName", handle, created_at AS "createdAt"
         FROM identity.profiles WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async isHandleTaken(handle: string): Promise<boolean> {
    // Also true for handles released less than 30 days ago.
    const rows = await readRows<{ available: boolean | null }>(
      this.pool,
      "identity.profiles.isHandleTaken",
      "SELECT identity.handle_available($1) AS available",
      [handle],
    );
    return rows[0]?.available !== true;
  }

  async create(input: {
    userId: string;
    displayName: string;
    handle: string;
  }): Promise<CreateProfileResult> {
    const rows = await readRows<{ outcome: string }>(
      this.pool,
      "identity.profiles.create",
      "SELECT identity.create_profile($1, $2, $3) AS outcome",
      [input.userId, input.displayName, input.handle],
    );
    const outcome = rows[0]?.outcome;
    if (outcome === "handle_taken" || outcome === "user_has_profile") {
      return { created: false, reason: outcome };
    }
    if (outcome !== "created") {
      throw new DataSourceUnavailableError("postgres.identity.profiles.create", {
        cause: new Error(`unexpected outcome ${String(outcome)}`),
      });
    }
    const profile = await this.findByUserId(input.userId);
    if (!profile) {
      throw new DataSourceUnavailableError("postgres.identity.profiles.create", {
        cause: new Error("profile missing after creation"),
      });
    }
    return { created: true, profile };
  }
}

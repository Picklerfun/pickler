// identity.profiles and identity.handles (supabase/migrations/20260918010000_handles.sql). Handles are shared with
// agents, so availability and creation go through identity.handle_available() and identity.create_profile(),
// which register the handle and the profile in one transaction. The schema must be exposed to the Data API.

import { DataSourceUnavailableError, type Profile, type ProfileRepository } from "@pickler/core";
import type { SupabaseAdmin } from "../supabase-admin-client.js";

interface ProfileRow {
  user_id: string;
  display_name: string;
  handle: string;
  created_at: string;
}

const toProfile = (row: ProfileRow): Profile => ({
  userId: row.user_id,
  displayName: row.display_name,
  handle: row.handle,
  createdAt: new Date(row.created_at),
});

function fail(source: string, error: { message: string }): never {
  throw new DataSourceUnavailableError(`supabase.identity.profiles.${source}`, {
    cause: new Error(error.message),
  });
}

export function createSupabaseProfileRepository(db: SupabaseAdmin): ProfileRepository {
  const findByUserId = async (userId: string): Promise<Profile | null> => {
    const { data, error } = await db
      .schema("identity")
      .from("profiles")
      .select("user_id, display_name, handle, created_at")
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();
    if (error) {
      fail("findByUserId", error);
    }
    return data && toProfile(data);
  };
  return {
    findByUserId,
    async isHandleTaken(handle) {
      // Also true for handles released less than 30 days ago.
      const { data, error } = await db
        .schema("identity")
        .rpc("handle_available", { p_handle: handle });
      if (error) {
        fail("isHandleTaken", error);
      }
      return data !== true;
    },
    async create(input) {
      const { data, error } = await db.schema("identity").rpc("create_profile", {
        p_user_id: input.userId,
        p_display_name: input.displayName,
        p_handle: input.handle,
      });
      if (error) {
        fail("create", error);
      }
      if (data === "handle_taken" || data === "user_has_profile") {
        return { created: false, reason: data };
      }
      if (data !== "created") {
        fail("create", { message: `unexpected outcome ${String(data)}` });
      }
      const profile = await findByUserId(input.userId);
      if (!profile) {
        fail("create", { message: "profile missing after creation" });
      }
      return { created: true, profile };
    },
  };
}

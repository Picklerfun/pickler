import { DataSourceUnavailableError, type WaitlistRepository } from "@pickler/core";
import { z } from "zod";
import type { SupabaseRestClient } from "./supabase-rest-client.js";

// growth.join_waitlist returns a single-row table.
const placementSchema = z
  .array(
    z.object({
      line_position: z.coerce.number().int().positive(),
      already_joined: z.boolean(),
      apply_token: z.uuid().nullable(),
    }),
  )
  .length(1);

export function createSupabaseWaitlist(client: SupabaseRestClient): WaitlistRepository {
  return {
    async join(email, referralCode) {
      // Not retried: a timeout is ambiguous, and the function is idempotent per email for a manual retry.
      const body = await client.rpc("join_waitlist", {
        p_email: email,
        p_referral_code: referralCode,
      });
      const parsed = placementSchema.safeParse(body);
      if (!parsed.success) {
        throw new DataSourceUnavailableError("supabase.rpc.join_waitlist", { cause: parsed.error });
      }
      const row = parsed.data[0]!;
      return {
        position: row.line_position,
        alreadyJoined: row.already_joined,
        applyToken: row.apply_token,
      };
    },
  };
}

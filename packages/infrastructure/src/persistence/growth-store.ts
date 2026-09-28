import type { Pool } from "pg";
import {
  DataSourceUnavailableError,
  type Applicant,
  type Application,
  type ApplicantRepository,
  type SubmitOutcome,
  type WaitlistPlacement,
  type WaitlistRepository,
} from "@pickler/core";
import { z } from "zod";
import { applicantSchema, outcomeSchema } from "../supabase/supabase-applicants.js";
import { placementSchema } from "../supabase/supabase-waitlist.js";
import { readRows } from "./data-source.js";

// The growth schema's security-definer functions (drizzle/0006_product_functions_and_grants.sql)
// over the API's pool: the same calls the Supabase adapters made through PostgREST, and the same
// schemas check what comes back, so a function whose shape drifts fails as unavailable.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse<T>(schema: z.ZodType<T>, body: unknown, fn: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new DataSourceUnavailableError(`postgres.growth.${fn}`, { cause: parsed.error });
  }
  return parsed.data;
}

async function call(pool: Pool, fn: string, args: unknown[]): Promise<unknown> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await readRows<{ result: unknown }>(
    pool,
    `growth.${fn}`,
    `SELECT growth.${fn}(${placeholders}) AS result`,
    args,
  );
  return rows[0]?.result;
}

export class PostgresWaitlist implements WaitlistRepository {
  constructor(private readonly pool: Pool) {}

  async join(email: string, referralCode: string | null): Promise<WaitlistPlacement> {
    // Not retried: a timeout is ambiguous, and the function is idempotent per email for a manual retry.
    const rows = await readRows(
      this.pool,
      "growth.join_waitlist",
      "SELECT line_position, already_joined, apply_token FROM growth.join_waitlist($1, $2)",
      [email, referralCode],
    );
    const row = parse(placementSchema, rows, "join_waitlist")[0]!;
    return {
      position: row.line_position,
      alreadyJoined: row.already_joined,
      applyToken: row.apply_token,
    };
  }
}

export class PostgresApplicants implements ApplicantRepository {
  constructor(private readonly pool: Pool) {}

  async findByToken(token: string): Promise<Applicant | null> {
    // Malformed tokens would make Postgres reject the uuid cast; they simply match no seat.
    if (!UUID.test(token)) {
      return null;
    }
    return parse(
      applicantSchema,
      (await call(this.pool, "applicant_by_token", [token])) ?? null,
      "applicant_by_token",
    );
  }

  async submit(token: string, application: Application): Promise<SubmitOutcome> {
    if (!UUID.test(token)) {
      return "not_found";
    }
    // Not retried: a lost response may have stored the application; the caller re-reads state instead.
    const outcome = await call(this.pool, "submit_application", [
      token,
      application.agentName,
      application.ticker,
      application.xHandle,
      application.category,
      application.personality,
      application.edge,
      application.whyYou,
    ]);
    return parse(outcomeSchema, outcome, "submit_application");
  }

  async isTickerAvailable(ticker: string): Promise<boolean> {
    return parse(
      z.boolean(),
      await call(this.pool, "ticker_available", [ticker]),
      "ticker_available",
    );
  }
}

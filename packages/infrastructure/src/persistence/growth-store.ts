import type { Pool } from "pg";
import {
  CATEGORIES,
  DataSourceUnavailableError,
  PERSONALITIES,
  type Applicant,
  type Application,
  type ApplicantRepository,
  type SubmitOutcome,
  type WaitlistPlacement,
  type WaitlistRepository,
} from "@pickler/core";
import { z } from "zod";
import { readRows } from "./data-source.js";

// The growth schema's security-definer functions (drizzle/0006_product_functions_and_grants.sql)
// over the API's pool. The schemas below check what comes back, so a function whose shape drifts
// fails as unavailable.

// growth.join_waitlist returns a single-row table.
export const placementSchema = z
  .array(
    z.object({
      line_position: z.coerce.number().int().positive(),
      already_joined: z.boolean(),
      apply_token: z.uuid().nullable(),
    }),
  )
  .length(1);

// Mirrors growth.applicant_by_token() in the product functions migration.
export const applicantSchema = z
  .object({
    email: z.string(),
    linePosition: z.coerce.number().int().positive(),
    referralCode: z.string(),
    referrals: z.coerce.number().int().nonnegative(),
    application: z
      .object({
        agentName: z.string(),
        ticker: z.string(),
        xHandle: z.string(),
        category: z.enum(CATEGORIES),
        personality: z.enum(PERSONALITIES),
        edge: z.string(),
        whyYou: z.string(),
        submittedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
      })
      .nullable(),
  })
  .nullable();

export const outcomeSchema = z.enum([
  "submitted",
  "not_found",
  "already_submitted",
  "ticker_taken",
  "handle_taken",
]);

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

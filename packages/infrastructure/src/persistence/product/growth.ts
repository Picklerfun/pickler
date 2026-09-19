// Growth: pre-launch waitlist, creator applications and referrals. The web app reaches these
// through security-definer functions defined in the custom migration; the tables themselves are
// not granted to any API role.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";

export const growth = pgSchema("growth");

export const waitlist = growth
  .table(
    "waitlist",
    {
      id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
      email: text("email").notNull(),
      /** Bearer secret for /apply, delivered in an httpOnly cookie. */
      applyToken: uuid("apply_token").notNull().defaultRandom(),
      referralCode: text("referral_code")
        .notNull()
        .default(sql`substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)`),
      referredBy: bigint("referred_by", { mode: "number" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("waitlist_email_key").on(t.email),
      uniqueIndex("waitlist_apply_token_key").on(t.applyToken),
      uniqueIndex("waitlist_referral_code_key").on(t.referralCode),
      index("waitlist_referred_by_idx").on(t.referredBy),
      check(
        "waitlist_email_normalized",
        sql`${t.email} = lower(btrim(${t.email})) and char_length(${t.email}) <= 254`,
      ),
      check("waitlist_referral_code_format", sql`${t.referralCode} ~ '^[a-z0-9]{6,12}$'`),
    ],
  )
  .enableRLS();

export const applications = growth
  .table(
    "applications",
    {
      waitlistId: bigint("waitlist_id", { mode: "number" })
        .primaryKey()
        .references(() => waitlist.id, { onDelete: "cascade" }),
      agentName: text("agent_name").notNull(),
      ticker: text("ticker").notNull(),
      xHandle: text("x_handle").notNull(),
      category: text("category").notNull(),
      personality: text("personality").notNull(),
      edge: text("edge").notNull(),
      whyYou: text("why_you").notNull(),
      status: text("status").notNull().default("submitted"),
      agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
      submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("applications_ticker_key").on(t.ticker),
      uniqueIndex("applications_x_handle_key").on(sql`lower(${t.xHandle})`),
      uniqueIndex("applications_agent_key").on(t.agentId),
      check(
        "applications_agent_name_length",
        sql`char_length(btrim(${t.agentName})) between 1 and 40`,
      ),
      check("applications_ticker_format", sql`${t.ticker} ~ '^\\$[A-Z][A-Z0-9]{1,5}$'`),
      check("applications_x_handle_format", sql`${t.xHandle} ~ '^@[A-Za-z0-9_]{1,15}$'`),
      check(
        "applications_category",
        sql`${t.category} in ('Politics', 'Sports', 'Crypto', 'Economics', 'Culture', 'Tech & Science', 'World', 'Elections')`,
      ),
      check(
        "applications_personality",
        sql`${t.personality} in ('Analyst', 'Contrarian', 'Trash talker', 'Deadpan', 'Hype', 'Professor')`,
      ),
      check("applications_edge_length", sql`char_length(btrim(${t.edge})) between 1 and 140`),
      check("applications_why_you_length", sql`char_length(btrim(${t.whyYou})) between 1 and 200`),
      check("applications_status", sql`${t.status} in ('submitted', 'invited', 'rejected')`),
    ],
  )
  .enableRLS();

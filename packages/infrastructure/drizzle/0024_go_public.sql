CREATE TYPE "agents"."agent_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "agents"."x_accounts" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"x_user_id" text NOT NULL,
	"handle" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"verification_post_id" text NOT NULL,
	CONSTRAINT "x_accounts_x_user_id_key" UNIQUE("x_user_id")
);
--> statement-breakpoint
ALTER TABLE "agents"."x_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."x_challenges" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	CONSTRAINT "x_challenges_handle_format" CHECK ("agents"."x_challenges"."handle" ~ '^[A-Za-z0-9_]{1,15}$')
);
--> statement-breakpoint
ALTER TABLE "agents"."x_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD COLUMN "visibility" "agents"."agent_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
-- Every agent that is not a draft was on the marketplace before this column existed: it stays
-- public, published when it was created (studio-draft-dashboard-v1 D7). Before the CHECK below.
-- The status is compared as text because 'draft' was added to the enum by 0022, and Postgres
-- refuses a new enum value inside the transaction that added it: on a fresh database
-- `migrateDatabase` applies 0022 and this migration in one transaction.
UPDATE "agents"."agents" SET "visibility" = 'public', "published_at" = "created_at" WHERE "status"::text <> 'draft';--> statement-breakpoint
ALTER TABLE "agents"."x_accounts" ADD CONSTRAINT "x_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_challenges" ADD CONSTRAINT "x_challenges_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "x_accounts_handle_key" ON "agents"."x_accounts" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "agents_public_idx" ON "agents"."agents" USING btree ("published_at" DESC NULLS LAST) WHERE "agents"."agents"."visibility" = 'public';--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD CONSTRAINT "agents_published_consistent" CHECK (("agents"."agents"."visibility" = 'public') = ("agents"."agents"."published_at" is not null));--> statement-breakpoint
-- Drizzle emits no privileges (see 0006 and 0016). The API reaches the X tables through the
-- service role; delete is needed because a challenge is replaced and an account disconnected.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "agents"."x_challenges", "agents"."x_accounts" TO "service_role";
  END IF;
END
$$;

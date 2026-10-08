CREATE TABLE "agents"."x_account_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"x_user_id" text NOT NULL,
	"handle" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"verification_post_id" text,
	"verification_method" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents"."x_account_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."x_api_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"policy_version" integer NOT NULL,
	"reserved_resources" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "x_call_kind" CHECK ("agents"."x_api_calls"."kind" in ('identity','posts')),
	CONSTRAINT "x_call_resources" CHECK ("agents"."x_api_calls"."reserved_resources" > 0)
);
--> statement-breakpoint
ALTER TABLE "agents"."x_api_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."x_api_usage" (
	"agent_id" uuid NOT NULL,
	"day" text NOT NULL,
	"identity_requests" integer DEFAULT 0 NOT NULL,
	"post_requests" integer DEFAULT 0 NOT NULL,
	"post_resources" integer DEFAULT 0 NOT NULL,
	"policy_version" integer NOT NULL,
	"retry_at" timestamp with time zone,
	CONSTRAINT "x_api_usage_agent_id_day_pk" PRIMARY KEY("agent_id","day"),
	CONSTRAINT "x_usage_nonnegative" CHECK ("agents"."x_api_usage"."identity_requests">=0 and "agents"."x_api_usage"."post_requests">=0 and "agents"."x_api_usage"."post_resources">=0)
);
--> statement-breakpoint
ALTER TABLE "agents"."x_api_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."x_oauth_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"browser_hash" text NOT NULL,
	"verifier" text NOT NULL,
	"key_version" integer NOT NULL,
	"return_to" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_oauth_attempts_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "x_attempt_status" CHECK ("agents"."x_oauth_attempts"."status" in ('pending','processing','finished'))
);
--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."x_oauth_grants" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text NOT NULL,
	"tokens" text,
	"key_version" integer NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"refresh_claim" text,
	"refresh_started_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	CONSTRAINT "x_grant_status" CHECK ("agents"."x_oauth_grants"."status" in ('connected','reconnect_required','revocation_pending')),
	CONSTRAINT "x_grant_version" CHECK ("agents"."x_oauth_grants"."version">0 and "agents"."x_oauth_grants"."key_version">0)
);
--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."x_oauth_revocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"token" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_revocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents"."x_accounts" ALTER COLUMN "verification_post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."x_accounts" ADD COLUMN "verification_method" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."x_account_history" ADD CONSTRAINT "x_account_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_api_calls" ADD CONSTRAINT "x_api_calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_api_usage" ADD CONSTRAINT "x_api_usage_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_attempts" ADD CONSTRAINT "x_oauth_attempts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_attempts" ADD CONSTRAINT "x_oauth_attempts_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_attempts" ADD CONSTRAINT "x_oauth_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_grants" ADD CONSTRAINT "x_oauth_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_grants" ADD CONSTRAINT "x_oauth_grants_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_grants" ADD CONSTRAINT "x_oauth_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."x_oauth_revocations" ADD CONSTRAINT "x_oauth_revocations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Preserve existing evidence before future reconnections update active identities.
INSERT INTO agents.x_account_history (id,agent_id,x_user_id,handle,verified_at,verification_post_id,verification_method)
SELECT gen_random_uuid(),agent_id,x_user_id,handle,verified_at,verification_post_id,'post' FROM agents.x_accounts;
--> statement-breakpoint
DO $$
DECLARE role_name text;
BEGIN
  REVOKE ALL ON agents.x_oauth_attempts, agents.x_oauth_grants, agents.x_api_usage, agents.x_api_calls, agents.x_oauth_revocations, agents.x_account_history FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON agents.x_oauth_attempts, agents.x_oauth_grants, agents.x_api_usage, agents.x_api_calls, agents.x_oauth_revocations, agents.x_account_history FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON agents.x_oauth_attempts, agents.x_oauth_grants, agents.x_api_usage, agents.x_oauth_revocations TO service_role;
    GRANT SELECT, INSERT ON agents.x_api_calls, agents.x_account_history TO service_role;
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION agents.reject_x_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'X request accounting and history are append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER x_api_calls_immutable BEFORE UPDATE OR DELETE ON agents.x_api_calls FOR EACH ROW EXECUTE FUNCTION agents.reject_x_history_mutation();
--> statement-breakpoint
CREATE TRIGGER x_account_history_immutable BEFORE UPDATE OR DELETE ON agents.x_account_history FOR EACH ROW EXECUTE FUNCTION agents.reject_x_history_mutation();

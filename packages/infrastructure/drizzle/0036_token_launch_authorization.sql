CREATE TABLE "launch"."agent_keys" (
	"agent_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"agent_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_keys_agent_id_chain_pk" PRIMARY KEY("agent_id","chain"),
	CONSTRAINT "agent_keys_chain_format" CHECK ("launch"."agent_keys"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "agent_keys_hash_format" CHECK ("launch"."agent_keys"."agent_key" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "launch"."agent_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launch"."grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"draft_version" integer NOT NULL,
	"owner_id" uuid NOT NULL,
	"factory" text NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grants_factory_format" CHECK ("launch"."grants"."factory" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "grants_nonce_range" CHECK ("launch"."grants"."nonce" >= 0 AND "launch"."grants"."nonce" < power(2::numeric, 256)),
	CONSTRAINT "grants_version_positive" CHECK ("launch"."grants"."draft_version" > 0),
	CONSTRAINT "grants_expiry" CHECK ("launch"."grants"."expires_at" > "launch"."grants"."created_at" AND "launch"."grants"."expires_at" <= "launch"."grants"."created_at" + interval '5 minutes')
);
--> statement-breakpoint
ALTER TABLE "launch"."grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_agent_chain_key" ON "launch"."drafts" USING btree ("agent_id","chain");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_identity_key" ON "launch"."drafts" USING btree ("id","agent_id","chain");

--> statement-breakpoint
ALTER TABLE "launch"."agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."grants" ADD CONSTRAINT "grants_owner_id_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."grants" ADD CONSTRAINT "grants_agent_id_chain_agent_keys_agent_id_chain_fk" FOREIGN KEY ("agent_id","chain") REFERENCES "launch"."agent_keys"("agent_id","chain") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."grants" ADD CONSTRAINT "grants_draft_id_agent_id_chain_drafts_id_agent_id_chain_fk" FOREIGN KEY ("draft_id","agent_id","chain") REFERENCES "launch"."drafts"("id","agent_id","chain") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_chain_key" ON "launch"."agent_keys" USING btree ("chain","agent_key");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_request_key" ON "launch"."grants" USING btree ("agent_id","chain","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_nonce_key" ON "launch"."grants" USING btree ("chain","factory","nonce");--> statement-breakpoint
--> statement-breakpoint
REVOKE ALL ON launch.agent_keys,launch.grants FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON launch.agent_keys,launch.grants FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON launch.agent_keys,launch.grants FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT ON launch.agent_keys,launch.grants TO service_role;
  END IF;
END $$;

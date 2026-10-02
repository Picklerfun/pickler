CREATE TABLE "agents"."setup_versions" (
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_versions_agent_id_version_pk" PRIMARY KEY("agent_id","version"),
	CONSTRAINT "setup_versions_version_positive" CHECK ("agents"."setup_versions"."version" > 0),
	CONSTRAINT "setup_versions_summary_length" CHECK (char_length("agents"."setup_versions"."summary") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "agents"."setup_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents"."setup_versions" ADD CONSTRAINT "setup_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Drizzle emits no privileges (see 0006, 0016 and 0024). The API writes a version with the config
-- it saves and lists them, through the service role. A version is never edited, and goes only with
-- its agent (the cascade above), so there is no update or delete.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON "agents"."setup_versions" TO "service_role";
  END IF;
END
$$;

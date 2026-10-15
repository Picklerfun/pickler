CREATE TABLE "launch"."operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"request_key" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_chain" CHECK ("launch"."operations"."chain" = 'eip155:10143'),
	CONSTRAINT "operations_action" CHECK ("launch"."operations"."action" IN ('launch','collect_curve_fees','collect_lp_fees','claim_fees')),
	CONSTRAINT "operations_status" CHECK ("launch"."operations"."status" IN ('preparing','awaiting_signature','signing','signed','confirming','included','finalized','failed','cancelled','unknown')),
	CONSTRAINT "operations_version" CHECK ("launch"."operations"."version" > 0),
	CONSTRAINT "operations_nonce" CHECK ("launch"."operations"."nonce" >= 0 AND "launch"."operations"."nonce" < power(2::numeric,256))
);
--> statement-breakpoint
ALTER TABLE "launch"."operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD CONSTRAINT "operations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD CONSTRAINT "operations_owner_id_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD CONSTRAINT "operations_transaction_id_transaction_requests_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "launch"."transaction_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operations_request_key" ON "launch"."operations" USING btree ("agent_id","chain","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_nonce_key" ON "launch"."operations" USING btree ("chain","nonce");--> statement-breakpoint
CREATE INDEX "operations_agent_status" ON "launch"."operations" USING btree ("agent_id","chain","status");
--> statement-breakpoint
REVOKE ALL ON launch.operations FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF to_regrole(role_name) IS NOT NULL THEN EXECUTE format('REVOKE ALL ON launch.operations FROM %I', role_name); END IF;
  END LOOP;
  IF to_regrole('service_role') IS NOT NULL THEN GRANT ALL ON launch.operations TO service_role; END IF;
END $$;

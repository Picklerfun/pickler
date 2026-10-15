CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance_units" numeric(30, 0) DEFAULT '0' NOT NULL,
	"reserved_units" numeric(30, 0) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_account_status" CHECK ("billing"."ai_credit_accounts"."status" in ('active','blocked')),
	CONSTRAINT "ai_credit_account_projection" CHECK ("billing"."ai_credit_accounts"."reserved_units" >= 0 AND "billing"."ai_credit_accounts"."version" >= 0 AND ("billing"."ai_credit_accounts"."balance_units" >= 0 OR "billing"."ai_credit_accounts"."status" = 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_agent_limits" (
	"product_agent_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"daily_units" numeric(30, 0),
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_limit_amount" CHECK (("billing"."ai_credit_agent_limits"."daily_units" is null OR "billing"."ai_credit_agent_limits"."daily_units" >= 0) AND "billing"."ai_credit_agent_limits"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_agent_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_call_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"call_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"rate" jsonb NOT NULL,
	"maximum_units" numeric(30, 0) NOT NULL,
	"charged_units" numeric(30, 0),
	"request_sha256" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"started_at" timestamp with time zone,
	CONSTRAINT "ai_credit_call_status" CHECK ("billing"."ai_credit_call_allocations"."status" in ('reserved','started','settled','released')),
	CONSTRAINT "ai_credit_call_amount" CHECK ("billing"."ai_credit_call_allocations"."maximum_units" >= 0 AND ("billing"."ai_credit_call_allocations"."charged_units" is null OR ("billing"."ai_credit_call_allocations"."charged_units" >= 0 AND "billing"."ai_credit_call_allocations"."charged_units" <= "billing"."ai_credit_call_allocations"."maximum_units")))
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_call_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing"."ai_credit_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"balance_delta_units" numeric(30, 0) NOT NULL,
	"reserved_delta_units" numeric(30, 0) NOT NULL,
	"operation_id" uuid,
	"purchase_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_ledger_kind" CHECK ("billing"."ai_credit_ledger"."kind" in ('purchase','reserve','settle','release','adjustment')),
	CONSTRAINT "ai_credit_ledger_deltas" CHECK (
    ("billing"."ai_credit_ledger"."kind" = 'purchase' AND "billing"."ai_credit_ledger"."balance_delta_units" > 0 AND "billing"."ai_credit_ledger"."reserved_delta_units" = 0 AND "billing"."ai_credit_ledger"."purchase_id" is not null) OR
    ("billing"."ai_credit_ledger"."kind" = 'reserve' AND "billing"."ai_credit_ledger"."balance_delta_units" = 0 AND "billing"."ai_credit_ledger"."reserved_delta_units" >= 0 AND "billing"."ai_credit_ledger"."operation_id" is not null) OR
    ("billing"."ai_credit_ledger"."kind" = 'settle' AND "billing"."ai_credit_ledger"."balance_delta_units" <= 0 AND "billing"."ai_credit_ledger"."reserved_delta_units" <= 0 AND "billing"."ai_credit_ledger"."operation_id" is not null) OR
    ("billing"."ai_credit_ledger"."kind" = 'release' AND "billing"."ai_credit_ledger"."balance_delta_units" = 0 AND "billing"."ai_credit_ledger"."reserved_delta_units" <= 0 AND "billing"."ai_credit_ledger"."operation_id" is not null) OR
    ("billing"."ai_credit_ledger"."kind" = 'adjustment' AND "billing"."ai_credit_ledger"."reserved_delta_units" = 0 AND "billing"."ai_credit_ledger"."balance_delta_units" <> 0))
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"product_agent_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"runtime_agent_id" text NOT NULL,
	"config_version" integer NOT NULL,
	"lease_owner" uuid NOT NULL,
	"pricing_id" uuid NOT NULL,
	"maximum_units" numeric(30, 0) NOT NULL,
	"charged_units" numeric(30, 0) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"admitted_day" text NOT NULL,
	"limit_version" integer NOT NULL,
	"daily_limit_units" numeric(30, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_credit_operation_status" CHECK ("billing"."ai_credit_operations"."status" in ('active','settled','released')),
	CONSTRAINT "ai_credit_operation_amount" CHECK ("billing"."ai_credit_operations"."maximum_units" >= 0 AND "billing"."ai_credit_operations"."charged_units" >= 0 AND "billing"."ai_credit_operations"."charged_units" <= "billing"."ai_credit_operations"."maximum_units"),
	CONSTRAINT "ai_credit_operation_terminal" CHECK (("billing"."ai_credit_operations"."status" = 'active') = ("billing"."ai_credit_operations"."finished_at" is null) AND ("billing"."ai_credit_operations"."status" <> 'released' OR "billing"."ai_credit_operations"."charged_units" = 0))
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"amount" numeric(30, 0) NOT NULL,
	"unit" text NOT NULL,
	"scale" integer NOT NULL,
	"recipient" text NOT NULL,
	"expected_recipient" text NOT NULL,
	"evidence_sha256" text NOT NULL,
	"proof_sha256" text NOT NULL,
	"verification" text NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_payment_verification" CHECK ("billing"."ai_credit_payment_events"."verification" in ('verified','rejected')),
	CONSTRAINT "ai_credit_payment_amount" CHECK ("billing"."ai_credit_payment_events"."amount" >= 0 AND "billing"."ai_credit_payment_events"."scale" between 0 and 30)
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_pricing_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"rates" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_pricing_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."ai_credit_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"request_sha256" text NOT NULL,
	"credit_units" numeric(30, 0) NOT NULL,
	"payment_amount" numeric(30, 0) NOT NULL,
	"payment_unit" text NOT NULL,
	"payment_scale" integer NOT NULL,
	"payment_method" text NOT NULL,
	"quote_version" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_purchase_status" CHECK ("billing"."ai_credit_purchases"."status" in ('pending','confirmed','failed','expired','review_required')),
	CONSTRAINT "ai_credit_purchase_amounts" CHECK ("billing"."ai_credit_purchases"."credit_units" > 0 AND "billing"."ai_credit_purchases"."payment_amount" > 0 AND "billing"."ai_credit_purchases"."payment_scale" between 0 and 30)
);
--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_account_user" ON "billing"."ai_credit_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_call_identity" ON "billing"."ai_credit_call_allocations" USING btree ("check_id","call_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_ledger_key" ON "billing"."ai_credit_ledger" USING btree ("account_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_operation_check" ON "billing"."ai_credit_operations" USING btree ("check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_operation_account" ON "billing"."ai_credit_operations" USING btree ("id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_operation_call_parent" ON "billing"."ai_credit_operations" USING btree ("id","check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_payment_event" ON "billing"."ai_credit_payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_payment_identity" ON "billing"."ai_credit_payment_events" USING btree ("provider","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_pricing_version" ON "billing"."ai_credit_pricing_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_purchase_request" ON "billing"."ai_credit_purchases" USING btree ("account_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_purchase_account" ON "billing"."ai_credit_purchases" USING btree ("id","account_id");--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_agent_limits" ADD CONSTRAINT "ai_credit_agent_limits_product_agent_id_agents_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_agent_limits" ADD CONSTRAINT "ai_credit_agent_limits_account_id_ai_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."ai_credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_call_allocations" ADD CONSTRAINT "ai_credit_call_allocations_operation_id_check_id_ai_credit_operations_id_check_id_fk" FOREIGN KEY ("operation_id","check_id") REFERENCES "billing"."ai_credit_operations"("id","check_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_call_allocations" ADD CONSTRAINT "ai_credit_call_allocations_check_id_call_key_perps_check_calls_check_id_key_fk" FOREIGN KEY ("check_id","call_key") REFERENCES "pickler"."perps_check_calls"("check_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_account_id_ai_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."ai_credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_operation_id_account_id_ai_credit_operations_id_account_id_fk" FOREIGN KEY ("operation_id","account_id") REFERENCES "billing"."ai_credit_operations"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_purchase_id_account_id_ai_credit_purchases_id_account_id_fk" FOREIGN KEY ("purchase_id","account_id") REFERENCES "billing"."ai_credit_purchases"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_operations" ADD CONSTRAINT "ai_credit_operations_account_id_ai_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."ai_credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_operations" ADD CONSTRAINT "ai_credit_operations_check_id_perps_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "pickler"."perps_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_operations" ADD CONSTRAINT "ai_credit_operations_product_agent_id_agents_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_operations" ADD CONSTRAINT "ai_credit_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_operations" ADD CONSTRAINT "ai_credit_operations_pricing_id_ai_credit_pricing_versions_id_fk" FOREIGN KEY ("pricing_id") REFERENCES "billing"."ai_credit_pricing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_payment_events" ADD CONSTRAINT "ai_credit_payment_events_purchase_id_account_id_ai_credit_purchases_id_account_id_fk" FOREIGN KEY ("purchase_id","account_id") REFERENCES "billing"."ai_credit_purchases"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ai_credit_purchases" ADD CONSTRAINT "ai_credit_purchases_account_id_ai_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."ai_credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credit_ledger_history" ON "billing"."ai_credit_ledger" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "ai_credit_operation_agent_day" ON "billing"."ai_credit_operations" USING btree ("account_id","product_agent_id","admitted_day");
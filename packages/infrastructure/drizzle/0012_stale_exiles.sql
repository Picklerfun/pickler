CREATE TABLE "pickler"."perps_paper_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"network" text NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "perps_paper_network" CHECK ("pickler"."perps_paper_accounts"."network" in ('mainnet','testnet'))
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_paper_attempts" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"document" jsonb NOT NULL,
	"owner" text,
	"expires_at" bigint,
	CONSTRAINT "perps_paper_attempts_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_paper_movements" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "perps_paper_movements_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_paper_positions" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"symbol" text NOT NULL,
	"closed_at" bigint,
	"document" jsonb NOT NULL,
	CONSTRAINT "perps_paper_positions_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_accounts" ADD CONSTRAINT "perps_paper_accounts_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_attempts" ADD CONSTRAINT "perps_paper_attempts_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_movements" ADD CONSTRAINT "perps_paper_movements_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD CONSTRAINT "perps_paper_positions_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perps_paper_account_scope" ON "pickler"."perps_paper_accounts" USING btree ("tenant_id","agent_id","session_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX "perps_paper_open_symbol" ON "pickler"."perps_paper_positions" USING btree ("account_id","symbol") WHERE "pickler"."perps_paper_positions"."closed_at" is null;
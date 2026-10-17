CREATE TABLE "pickler"."perpl_live_accounts" (
	"product_agent_id" uuid PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perpl_live_document_version" CHECK ("pickler"."perpl_live_accounts"."document"->>'version' = '1')
);
--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD CONSTRAINT "perpl_live_accounts_product_agent_id_product_agents_product_agent_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "pickler"."product_agents"("product_agent_id") ON DELETE no action ON UPDATE no action;
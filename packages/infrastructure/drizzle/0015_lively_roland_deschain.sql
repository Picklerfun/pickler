CREATE TABLE "wallets"."agent_wallets" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"policy_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_wallets_policies" CHECK (cardinality("wallets"."agent_wallets"."policy_ids") >= 2)
);
--> statement-breakpoint
ALTER TABLE "wallets"."agent_wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wallets"."deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tx_hash" text NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_tx_format" CHECK ("wallets"."deposits"."tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "deposits_amount_positive" CHECK ("wallets"."deposits"."amount_micro_usd" > 0)
);
--> statement-breakpoint
ALTER TABLE "wallets"."deposits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallets"."turnkey_orgs" ADD COLUMN "delegated_user_id" text;--> statement-breakpoint
ALTER TABLE "wallets"."agent_wallets" ADD CONSTRAINT "agent_wallets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets"."agent_wallets" ADD CONSTRAINT "agent_wallets_wallet_id_wallets_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"."wallets"("wallet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets"."deposits" ADD CONSTRAINT "deposits_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_wallets_wallet_key" ON "wallets"."agent_wallets" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tx_key" ON "wallets"."deposits" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "deposits_agent_idx" ON "wallets"."deposits" USING btree ("agent_id");
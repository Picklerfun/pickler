CREATE TABLE "wallets"."transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_wallet_id" text NOT NULL,
	"to_wallet_id" text NOT NULL,
	"token" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_token" CHECK ("wallets"."transfers"."token" in ('ausd', 'mon')),
	CONSTRAINT "transfers_amount_positive" CHECK ("wallets"."transfers"."amount" > 0),
	CONSTRAINT "transfers_tx_format" CHECK ("wallets"."transfers"."tx_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "wallets"."transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD COLUMN "avatar_pattern" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_tx_key" ON "wallets"."transfers" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "transfers_user_idx" ON "wallets"."transfers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_avatar_pattern" CHECK ("agents"."agent_profiles"."avatar_pattern" between 0 and 5);
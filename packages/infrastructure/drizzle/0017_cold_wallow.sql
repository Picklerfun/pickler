CREATE SCHEMA "wallets";
--> statement-breakpoint
CREATE TABLE "wallets"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"label" text NOT NULL,
	"transports" text[] DEFAULT array[]::text[] NOT NULL,
	"device_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wallets"."passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wallets"."turnkey_orgs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sub_organization_id" text NOT NULL,
	"master_wallet_id" text NOT NULL,
	"root_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets"."turnkey_orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wallets"."wallet_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" text NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"address_format" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_accounts_chain" CHECK ("wallets"."wallet_accounts"."chain" in ('monad')),
	CONSTRAINT "wallet_accounts_address_format" CHECK ("wallets"."wallet_accounts"."address" ~ '^0x[0-9a-fA-F]{40}$')
);
--> statement-breakpoint
ALTER TABLE "wallets"."wallet_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wallets"."wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" text NOT NULL,
	"sub_organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_kind" CHECK ("wallets"."wallets"."kind" in ('master', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "wallets"."wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wallets"."webauthn_challenges" (
	"challenge" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets"."webauthn_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_key" ON "wallets"."passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "wallets"."passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turnkey_orgs_sub_organization_key" ON "wallets"."turnkey_orgs" USING btree ("sub_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_accounts_wallet_path_key" ON "wallets"."wallet_accounts" USING btree ("wallet_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_wallet_key" ON "wallets"."wallets" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets"."wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expiry_idx" ON "wallets"."webauthn_challenges" USING btree ("expires_at");
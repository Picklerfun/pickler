CREATE SCHEMA "agents";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "budget";
--> statement-breakpoint
CREATE SCHEMA "growth";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "market";
--> statement-breakpoint
CREATE TYPE "agents"."accent" AS ENUM('lime', 'cyan', 'amber', 'orange', 'magenta', 'violet', 'blue');--> statement-breakpoint
CREATE TYPE "agents"."agent_status" AS ENUM('pending_policies', 'active', 'paused', 'suspended', 'draining', 'killed');--> statement-breakpoint
CREATE TYPE "budget"."category" AS ENUM('infra', 'tokens', 'payments');--> statement-breakpoint
CREATE TYPE "budget"."ledger_action" AS ENUM('reserve', 'commit', 'release', 'record', 'configure', 'reset');--> statement-breakpoint
CREATE TYPE "identity"."member_role" AS ENUM('admin', 'manager', 'developer', 'auditor', 'viewer');--> statement-breakpoint
CREATE TYPE "market"."candle_interval" AS ENUM('5m', '1h', '4h', '1d');--> statement-breakpoint
CREATE TYPE "market"."fee_recipient_role" AS ENUM('creator', 'agent', 'platform');--> statement-breakpoint
CREATE TYPE "market"."pool_phase" AS ENUM('pre_graduation', 'post_graduation');--> statement-breakpoint
CREATE TYPE "market"."token_status" AS ENUM('reserved', 'launching', 'pre_graduation', 'graduated', 'failed');--> statement-breakpoint
CREATE TYPE "market"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "agents"."agent_configs" (
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"personality" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strategy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_agent_id_version_pk" PRIMARY KEY("agent_id","version"),
	CONSTRAINT "agent_configs_version_positive" CHECK ("agents"."agent_configs"."version" > 0),
	CONSTRAINT "agent_configs_sources_array" CHECK (jsonb_typeof("agents"."agent_configs"."sources") = 'array'),
	CONSTRAINT "agent_configs_strategy_object" CHECK (jsonb_typeof("agents"."agent_configs"."strategy") = 'object'),
	CONSTRAINT "agent_configs_prompt_hash" CHECK ("agents"."agent_configs"."prompt_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agents"."agent_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."agent_credentials" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_hmac_secret" text NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_credentials_key_version" CHECK ("agents"."agent_credentials"."key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "agents"."agent_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"workspace_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_events_type_length" CHECK (char_length("agents"."agent_events"."event_type") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "agents"."agent_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."agent_profiles" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"beat" text,
	"accent" "agents"."accent" DEFAULT 'lime' NOT NULL,
	"x_handle" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profiles_blurb_length" CHECK (char_length("agents"."agent_profiles"."blurb") <= 280),
	CONSTRAINT "agent_profiles_beat_length" CHECK (char_length("agents"."agent_profiles"."beat") <= 40),
	CONSTRAINT "agent_profiles_x_handle_format" CHECK ("agents"."agent_profiles"."x_handle" ~ '^@[A-Za-z0-9_]{1,15}$')
);
--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents"."agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"status" "agents"."agent_status" DEFAULT 'pending_policies' NOT NULL,
	"chain_id" integer,
	"active_config_version" integer,
	"created_by" uuid,
	"killed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_name_length" CHECK (char_length("agents"."agents"."name") between 1 and 40),
	CONSTRAINT "agents_chain_id_check" CHECK ("agents"."agents"."chain_id" > 0),
	CONSTRAINT "agents_killed_consistent" CHECK (("agents"."agents"."status" = 'killed') = ("agents"."agents"."killed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "agents"."agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" uuid,
	"ip_address" "inet",
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_actor_type" CHECK ("audit"."events"."actor_type" in ('user', 'api_key', 'agent', 'system')),
	CONSTRAINT "events_action_length" CHECK (char_length("audit"."events"."action") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "audit"."events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit"."idempotency_keys" (
	"workspace_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_workspace_id_endpoint_key_pk" PRIMARY KEY("workspace_id","endpoint","key"),
	CONSTRAINT "idempotency_keys_key_length" CHECK (char_length("audit"."idempotency_keys"."key") between 1 and 200),
	CONSTRAINT "idempotency_keys_request_hash" CHECK ("audit"."idempotency_keys"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit"."idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget"."budgets" (
	"agent_id" uuid NOT NULL,
	"category" "budget"."category" NOT NULL,
	"limit_micro_usd" bigint NOT NULL,
	"spent_micro_usd" bigint DEFAULT 0 NOT NULL,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	"period_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_agent_id_category_pk" PRIMARY KEY("agent_id","category"),
	CONSTRAINT "budgets_limit_positive" CHECK ("budget"."budgets"."limit_micro_usd" >= 0),
	CONSTRAINT "budgets_spent_positive" CHECK ("budget"."budgets"."spent_micro_usd" >= 0),
	CONSTRAINT "budgets_reserved_positive" CHECK ("budget"."budgets"."reserved_micro_usd" >= 0),
	CONSTRAINT "budgets_period_key" CHECK ("budget"."budgets"."period_key" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "budget"."budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget"."ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budget"."ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_id" uuid NOT NULL,
	"category" "budget"."category" NOT NULL,
	"action" "budget"."ledger_action" NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"reservation_id" text,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("budget"."ledger_entries"."amount_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget"."ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "growth"."applications" (
	"waitlist_id" bigint PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"ticker" text NOT NULL,
	"x_handle" text NOT NULL,
	"category" text NOT NULL,
	"personality" text NOT NULL,
	"edge" text NOT NULL,
	"why_you" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"agent_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_agent_name_length" CHECK (char_length(btrim("growth"."applications"."agent_name")) between 1 and 40),
	CONSTRAINT "applications_ticker_format" CHECK ("growth"."applications"."ticker" ~ '^\$[A-Z][A-Z0-9]{1,5}$'),
	CONSTRAINT "applications_x_handle_format" CHECK ("growth"."applications"."x_handle" ~ '^@[A-Za-z0-9_]{1,15}$'),
	CONSTRAINT "applications_category" CHECK ("growth"."applications"."category" in ('Politics', 'Sports', 'Crypto', 'Economics', 'Culture', 'Tech & Science', 'World', 'Elections')),
	CONSTRAINT "applications_personality" CHECK ("growth"."applications"."personality" in ('Analyst', 'Contrarian', 'Trash talker', 'Deadpan', 'Hype', 'Professor')),
	CONSTRAINT "applications_edge_length" CHECK (char_length(btrim("growth"."applications"."edge")) between 1 and 140),
	CONSTRAINT "applications_why_you_length" CHECK (char_length(btrim("growth"."applications"."why_you")) between 1 and 200),
	CONSTRAINT "applications_status" CHECK ("growth"."applications"."status" in ('submitted', 'invited', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "growth"."applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "growth"."waitlist" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "growth"."waitlist_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"apply_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"referral_code" text DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) NOT NULL,
	"referred_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_normalized" CHECK ("growth"."waitlist"."email" = lower(btrim("growth"."waitlist"."email")) and char_length("growth"."waitlist"."email") <= 254),
	CONSTRAINT "waitlist_referral_code_format" CHECK ("growth"."waitlist"."referral_code" ~ '^[a-z0-9]{6,12}$')
);
--> statement-breakpoint
ALTER TABLE "growth"."waitlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"display_prefix" text,
	"scopes" text[] DEFAULT array[]::text[] NOT NULL,
	"allowed_cidrs" "cidr"[],
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_name_length" CHECK (char_length("identity"."api_keys"."name") between 1 and 80),
	CONSTRAINT "api_keys_hash_format" CHECK ("identity"."api_keys"."hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "identity"."api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."handle_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "identity"."handle_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"handle" text NOT NULL,
	"owner_kind" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handle_history_owner_kind" CHECK ("identity"."handle_history"."owner_kind" in ('user', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "identity"."handle_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."handles" (
	"handle" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handles_format" CHECK ("identity"."handles"."handle" ~ '^[a-z0-9_]{3,15}$'),
	CONSTRAINT "handles_single_owner" CHECK (num_nonnulls("identity"."handles"."user_id", "identity"."handles"."agent_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "identity"."handles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_display_name_length" CHECK (char_length("identity"."profiles"."display_name") between 2 and 60),
	CONSTRAINT "profiles_handle_format" CHECK ("identity"."profiles"."handle" ~ '^[a-z0-9_]{3,15}$')
);
--> statement-breakpoint
ALTER TABLE "identity"."profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."wallet_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"verified_chain" text NOT NULL,
	"address" text NOT NULL,
	"method" text NOT NULL,
	"kind" text DEFAULT 'external' NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_links_namespace" CHECK ("identity"."wallet_links"."namespace" in ('eip155', 'solana')),
	CONSTRAINT "wallet_links_verified_chain" CHECK ("identity"."wallet_links"."verified_chain" ~ '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'),
	CONSTRAINT "wallet_links_verified_chain_family" CHECK (split_part("identity"."wallet_links"."verified_chain", ':', 1) = "identity"."wallet_links"."namespace"),
	CONSTRAINT "wallet_links_method_check" CHECK ("identity"."wallet_links"."method" in ('siwe', 'siws')),
	CONSTRAINT "wallet_links_kind" CHECK ("identity"."wallet_links"."kind" in ('external', 'mera')),
	CONSTRAINT "wallet_links_address_format" CHECK (("identity"."wallet_links"."namespace" = 'eip155' and "identity"."wallet_links"."address" ~ '^0x[0-9a-f]{40}$') or ("identity"."wallet_links"."namespace" = 'solana' and "identity"."wallet_links"."address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'))
);
--> statement-breakpoint
ALTER TABLE "identity"."wallet_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "identity"."member_role" DEFAULT 'viewer' NOT NULL,
	"invited_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "identity"."workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"active_modules" text[] DEFAULT array['agent']::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_length" CHECK (char_length("identity"."workspaces"."name") between 1 and 80),
	CONSTRAINT "workspaces_modules" CHECK ("identity"."workspaces"."active_modules" <@ array['signing', 'payout', 'action', 'agent']::text[])
);
--> statement-breakpoint
ALTER TABLE "identity"."workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."candles" (
	"token_id" uuid NOT NULL,
	"bucket" "market"."candle_interval" NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"open" numeric NOT NULL,
	"high" numeric NOT NULL,
	"low" numeric NOT NULL,
	"close" numeric NOT NULL,
	"volume_quote" numeric(78, 0) DEFAULT '0' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "candles_token_id_bucket_bucket_start_pk" PRIMARY KEY("token_id","bucket","bucket_start"),
	CONSTRAINT "candles_open_positive" CHECK ("market"."candles"."open" > 0),
	CONSTRAINT "candles_low_positive" CHECK ("market"."candles"."low" > 0),
	CONSTRAINT "candles_close_positive" CHECK ("market"."candles"."close" > 0),
	CONSTRAINT "candles_volume_positive" CHECK ("market"."candles"."volume_quote" >= 0),
	CONSTRAINT "candles_trade_count_positive" CHECK ("market"."candles"."trade_count" >= 0),
	CONSTRAINT "candles_range" CHECK ("market"."candles"."low" <= least("market"."candles"."open", "market"."candles"."close") and "market"."candles"."high" >= greatest("market"."candles"."open", "market"."candles"."close"))
);
--> statement-breakpoint
ALTER TABLE "market"."candles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."fee_payouts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market"."fee_payouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_id" uuid NOT NULL,
	"pool_id" uuid,
	"role" "market"."fee_recipient_role" NOT NULL,
	"recipient" text NOT NULL,
	"asset_address" text,
	"amount" numeric(78, 0) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	CONSTRAINT "fee_payouts_recipient_format" CHECK ("market"."fee_payouts"."recipient" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "fee_payouts_asset_format" CHECK ("market"."fee_payouts"."asset_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "fee_payouts_amount_positive" CHECK ("market"."fee_payouts"."amount" > 0),
	CONSTRAINT "fee_payouts_block_positive" CHECK ("market"."fee_payouts"."block_number" >= 0),
	CONSTRAINT "fee_payouts_block_hash_format" CHECK ("market"."fee_payouts"."block_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "fee_payouts_tx_hash_format" CHECK ("market"."fee_payouts"."tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "fee_payouts_log_index_positive" CHECK ("market"."fee_payouts"."log_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "market"."fee_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."fee_splits" (
	"token_id" uuid NOT NULL,
	"phase" "market"."pool_phase" NOT NULL,
	"role" "market"."fee_recipient_role" NOT NULL,
	"recipient" text NOT NULL,
	"share_bps" integer NOT NULL,
	CONSTRAINT "fee_splits_token_id_phase_role_pk" PRIMARY KEY("token_id","phase","role"),
	CONSTRAINT "fee_splits_recipient_format" CHECK ("market"."fee_splits"."recipient" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "fee_splits_share_range" CHECK ("market"."fee_splits"."share_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "market"."fee_splits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."holders" (
	"token_id" uuid NOT NULL,
	"address" text NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"updated_block" bigint NOT NULL,
	CONSTRAINT "holders_token_id_address_pk" PRIMARY KEY("token_id","address"),
	CONSTRAINT "holders_address_format" CHECK ("market"."holders"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "holders_balance_positive" CHECK ("market"."holders"."balance" >= 0),
	CONSTRAINT "holders_block_positive" CHECK ("market"."holders"."updated_block" >= 0)
);
--> statement-breakpoint
ALTER TABLE "market"."holders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."indexer_cursors" (
	"chain" text NOT NULL,
	"contract" text NOT NULL,
	"stream" text NOT NULL,
	"last_block" bigint NOT NULL,
	"last_block_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_cursors_chain_contract_stream_pk" PRIMARY KEY("chain","contract","stream"),
	CONSTRAINT "indexer_cursors_chain_format" CHECK ("market"."indexer_cursors"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "indexer_cursors_contract_format" CHECK ("market"."indexer_cursors"."contract" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "indexer_cursors_stream_length" CHECK (char_length("market"."indexer_cursors"."stream") between 1 and 40),
	CONSTRAINT "indexer_cursors_block_positive" CHECK ("market"."indexer_cursors"."last_block" >= 0),
	CONSTRAINT "indexer_cursors_block_hash_format" CHECK ("market"."indexer_cursors"."last_block_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "market"."indexer_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"phase" "market"."pool_phase" NOT NULL,
	"venue" text NOT NULL,
	"address" text,
	"pool_key" text,
	"opened_tx_hash" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_tx_hash" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "pools_venue" CHECK ("market"."pools"."venue" in ('pickler_curve', 'pons', 'uniswap_v4')),
	CONSTRAINT "pools_address_format" CHECK ("market"."pools"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "pools_pool_key_format" CHECK ("market"."pools"."pool_key" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "pools_opened_tx_format" CHECK ("market"."pools"."opened_tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "pools_closed_tx_format" CHECK ("market"."pools"."closed_tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "pools_locator" CHECK ("market"."pools"."address" is not null or "market"."pools"."pool_key" is not null),
	CONSTRAINT "pools_closed_consistent" CHECK (("market"."pools"."closed_at" is null) = ("market"."pools"."closed_tx_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "market"."pools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"image_uri" text,
	"chain" text NOT NULL,
	"address" text,
	"decimals" smallint DEFAULT 18 NOT NULL,
	"total_supply" numeric(78, 0),
	"quote_symbol" text,
	"quote_address" text,
	"quote_decimals" smallint,
	"graduation_target" numeric(78, 0),
	"status" "market"."token_status" DEFAULT 'reserved' NOT NULL,
	"launch_tx_hash" text,
	"launched_at" timestamp with time zone,
	"graduated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_ticker_format" CHECK ("market"."tokens"."ticker" ~ '^\$[A-Z][A-Z0-9]{1,5}$'),
	CONSTRAINT "tokens_name_length" CHECK (char_length("market"."tokens"."name") between 1 and 40),
	CONSTRAINT "tokens_image_uri" CHECK ("market"."tokens"."image_uri" ~ '^(https|ipfs)://'),
	CONSTRAINT "tokens_chain_format" CHECK ("market"."tokens"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "tokens_address_format" CHECK ("market"."tokens"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "tokens_decimals_range" CHECK ("market"."tokens"."decimals" between 0 and 36),
	CONSTRAINT "tokens_supply_positive" CHECK ("market"."tokens"."total_supply" > 0),
	CONSTRAINT "tokens_quote_address_format" CHECK ("market"."tokens"."quote_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "tokens_quote_decimals_range" CHECK ("market"."tokens"."quote_decimals" between 0 and 36),
	CONSTRAINT "tokens_graduation_target_positive" CHECK ("market"."tokens"."graduation_target" > 0),
	CONSTRAINT "tokens_launch_tx_format" CHECK ("market"."tokens"."launch_tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "tokens_launched_consistent" CHECK ("market"."tokens"."status" not in ('pre_graduation', 'graduated') or ("market"."tokens"."address" is not null and "market"."tokens"."launched_at" is not null and "market"."tokens"."total_supply" is not null and "market"."tokens"."quote_decimals" is not null)),
	CONSTRAINT "tokens_graduated_consistent" CHECK (("market"."tokens"."status" = 'graduated') = ("market"."tokens"."graduated_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "market"."tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."trades" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market"."trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pool_id" uuid NOT NULL,
	"side" "market"."trade_side" NOT NULL,
	"trader" text NOT NULL,
	"token_amount" numeric(78, 0) NOT NULL,
	"quote_amount" numeric(78, 0) NOT NULL,
	"fee_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	CONSTRAINT "trades_trader_format" CHECK ("market"."trades"."trader" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "trades_token_amount_positive" CHECK ("market"."trades"."token_amount" > 0),
	CONSTRAINT "trades_quote_amount_positive" CHECK ("market"."trades"."quote_amount" >= 0),
	CONSTRAINT "trades_fee_positive" CHECK ("market"."trades"."fee_amount" >= 0),
	CONSTRAINT "trades_block_positive" CHECK ("market"."trades"."block_number" >= 0),
	CONSTRAINT "trades_block_hash_format" CHECK ("market"."trades"."block_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "trades_tx_hash_format" CHECK ("market"."trades"."tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "trades_log_index_positive" CHECK ("market"."trades"."log_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "market"."trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents"."agent_configs" ADD CONSTRAINT "agent_configs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_events" ADD CONSTRAINT "agent_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_events" ADD CONSTRAINT "agent_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget"."budgets" ADD CONSTRAINT "budgets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget"."ledger_entries" ADD CONSTRAINT "ledger_entries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth"."applications" ADD CONSTRAINT "applications_waitlist_id_waitlist_id_fk" FOREIGN KEY ("waitlist_id") REFERENCES "growth"."waitlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth"."applications" ADD CONSTRAINT "applications_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."candles" ADD CONSTRAINT "candles_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "market"."tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."fee_payouts" ADD CONSTRAINT "fee_payouts_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "market"."tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."fee_payouts" ADD CONSTRAINT "fee_payouts_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "market"."pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."fee_splits" ADD CONSTRAINT "fee_splits_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "market"."tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."holders" ADD CONSTRAINT "holders_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "market"."tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."pools" ADD CONSTRAINT "pools_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "market"."tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."tokens" ADD CONSTRAINT "tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market"."trades" ADD CONSTRAINT "trades_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "market"."pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_configs_created_by_idx" ON "agents"."agent_configs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "agent_events_agent_idx" ON "agents"."agent_events" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_events_workspace_idx" ON "agents"."agent_events" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profiles_x_handle_key" ON "agents"."agent_profiles" USING btree (lower("x_handle")) WHERE "agents"."agent_profiles"."x_handle" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_handle_key" ON "agents"."agents" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "agents_workspace_idx" ON "agents"."agents" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agents_created_by_idx" ON "agents"."agents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "agents_handle_owner_idx" ON "agents"."agents" USING btree ("handle","id");--> statement-breakpoint
CREATE INDEX "agents_active_config_idx" ON "agents"."agents" USING btree ("id","active_config_version");--> statement-breakpoint
CREATE INDEX "events_workspace_idx" ON "audit"."events" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_resource_idx" ON "audit"."events" USING btree ("resource_type","resource_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "audit"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_agent_idx" ON "budget"."ledger_entries" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reservation_action_key" ON "budget"."ledger_entries" USING btree ("reservation_id","action") WHERE "budget"."ledger_entries"."reservation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_ticker_key" ON "growth"."applications" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_x_handle_key" ON "growth"."applications" USING btree (lower("x_handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "applications_agent_key" ON "growth"."applications" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_key" ON "growth"."waitlist" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_apply_token_key" ON "growth"."waitlist" USING btree ("apply_token");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_referral_code_key" ON "growth"."waitlist" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "waitlist_referred_by_idx" ON "growth"."waitlist" USING btree ("referred_by");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_key" ON "identity"."api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "identity"."api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "identity"."api_keys" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "handle_history_handle_idx" ON "identity"."handle_history" USING btree ("handle","released_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "handles_user_key" ON "identity"."handles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handles_agent_key" ON "identity"."handles" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handles_handle_user_key" ON "identity"."handles" USING btree ("handle","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handles_handle_agent_key" ON "identity"."handles" USING btree ("handle","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_key" ON "identity"."profiles" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "profiles_handle_owner_idx" ON "identity"."profiles" USING btree ("handle","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_links_address_key" ON "identity"."wallet_links" USING btree ("namespace","address");--> statement-breakpoint
CREATE INDEX "wallet_links_user_idx" ON "identity"."wallet_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "identity"."workspace_members" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_members_invited_by_idx" ON "identity"."workspace_members" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_owner_key" ON "identity"."workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payouts_log_key" ON "market"."fee_payouts" USING btree ("token_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "fee_payouts_pool_idx" ON "market"."fee_payouts" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "holders_top_idx" ON "market"."holders" USING btree ("token_id","balance" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pools_token_phase_key" ON "market"."pools" USING btree ("token_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_agent_key" ON "market"."tokens" USING btree ("agent_id") WHERE "market"."tokens"."status" <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_ticker_key" ON "market"."tokens" USING btree ("ticker") WHERE "market"."tokens"."status" <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_address_key" ON "market"."tokens" USING btree ("chain","address") WHERE "market"."tokens"."address" is not null;--> statement-breakpoint
CREATE INDEX "tokens_agent_idx" ON "market"."tokens" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_log_key" ON "market"."trades" USING btree ("pool_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "trades_pool_time_idx" ON "market"."trades" USING btree ("pool_id","block_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "market"."trades" USING btree ("trader","block_time" DESC NULLS LAST);
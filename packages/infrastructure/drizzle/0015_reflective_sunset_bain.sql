CREATE SCHEMA "launch";
--> statement-breakpoint
CREATE TYPE "launch"."draft_status" AS ENUM('draft', 'validated', 'prepared', 'submitted', 'launched', 'abandoned');--> statement-breakpoint
CREATE TYPE "launch"."outbox_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "launch"."transaction_status" AS ENUM('prepared', 'submitted', 'included', 'finalized', 'reverted', 'replaced');--> statement-breakpoint
CREATE TABLE "launch"."drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid,
	"chain" text NOT NULL,
	"preset_id" integer,
	"preset_version" integer,
	"params" jsonb NOT NULL,
	"status" "launch"."draft_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"launched_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_chain_format" CHECK ("launch"."drafts"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "drafts_version_positive" CHECK ("launch"."drafts"."version" >= 1),
	CONSTRAINT "drafts_launched_token_format" CHECK ("launch"."drafts"."launched_token" is null or "launch"."drafts"."launched_token" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
ALTER TABLE "launch"."drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launch"."metadata_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain" text NOT NULL,
	"token" text NOT NULL,
	"uri" text NOT NULL,
	"content_hash" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_versions_chain_format" CHECK ("launch"."metadata_versions"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "metadata_versions_token_format" CHECK ("launch"."metadata_versions"."token" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "metadata_versions_hash_format" CHECK ("launch"."metadata_versions"."content_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "launch"."metadata_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launch"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_chain" text,
	"event_block_hash" text,
	"event_tx_hash" text,
	"event_log_index" integer,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "launch"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_attempts_positive" CHECK ("launch"."outbox"."attempts" >= 0),
	CONSTRAINT "outbox_topic_length" CHECK (char_length("launch"."outbox"."topic") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "launch"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launch"."presets" (
	"chain" text NOT NULL,
	"preset_id" integer NOT NULL,
	"version" integer NOT NULL,
	"config_hash" text NOT NULL,
	"params" jsonb NOT NULL,
	"quote_address" text NOT NULL,
	"total_supply" numeric(78, 0) NOT NULL,
	"sale_allocation" numeric(78, 0) NOT NULL,
	"lp_allocation" numeric(78, 0) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"published_block" bigint NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presets_chain_preset_id_version_pk" PRIMARY KEY("chain","preset_id","version"),
	CONSTRAINT "presets_chain_format" CHECK ("launch"."presets"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "presets_config_hash_format" CHECK ("launch"."presets"."config_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "presets_quote_format" CHECK ("launch"."presets"."quote_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "presets_allocations_sum" CHECK ("launch"."presets"."total_supply" = "launch"."presets"."sale_allocation" + "launch"."presets"."lp_allocation"),
	CONSTRAINT "presets_lp_below_sale" CHECK ("launch"."presets"."lp_allocation" < "launch"."presets"."sale_allocation"),
	CONSTRAINT "presets_published_block_positive" CHECK ("launch"."presets"."published_block" >= 0)
);
--> statement-breakpoint
ALTER TABLE "launch"."presets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launch"."transaction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"chain" text NOT NULL,
	"sender" text NOT NULL,
	"destination" text NOT NULL,
	"params_hash" text NOT NULL,
	"idempotency_key" text,
	"status" "launch"."transaction_status" DEFAULT 'prepared' NOT NULL,
	"tx_hash" text,
	"block_hash" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_requests_chain_format" CHECK ("launch"."transaction_requests"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "transaction_requests_sender_format" CHECK ("launch"."transaction_requests"."sender" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "transaction_requests_destination_format" CHECK ("launch"."transaction_requests"."destination" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "transaction_requests_tx_hash_format" CHECK ("launch"."transaction_requests"."tx_hash" is null or "launch"."transaction_requests"."tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "transaction_requests_included_has_hash" CHECK ("launch"."transaction_requests"."status" not in ('included', 'finalized') or "launch"."transaction_requests"."tx_hash" is not null)
);
--> statement-breakpoint
ALTER TABLE "launch"."transaction_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."chain_blocks" (
	"chain" text NOT NULL,
	"hash" text NOT NULL,
	"number" bigint NOT NULL,
	"parent_hash" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"finality" text DEFAULT 'observed' NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_blocks_chain_hash_pk" PRIMARY KEY("chain","hash"),
	CONSTRAINT "chain_blocks_chain_format" CHECK ("market"."chain_blocks"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "chain_blocks_hash_format" CHECK ("market"."chain_blocks"."hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_blocks_parent_hash_format" CHECK ("market"."chain_blocks"."parent_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_blocks_number_positive" CHECK ("market"."chain_blocks"."number" >= 0),
	CONSTRAINT "chain_blocks_finality" CHECK ("market"."chain_blocks"."finality" in ('observed', 'confirmed', 'finalized'))
);
--> statement-breakpoint
ALTER TABLE "market"."chain_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."chain_events" (
	"chain" text NOT NULL,
	"block_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"emitter" text NOT NULL,
	"event_name" text NOT NULL,
	"abi_hash" text NOT NULL,
	"topics" jsonb NOT NULL,
	"data" text NOT NULL,
	"decoded" jsonb,
	"orphaned" boolean DEFAULT false NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_chain_block_hash_tx_hash_log_index_pk" PRIMARY KEY("chain","block_hash","tx_hash","log_index"),
	CONSTRAINT "chain_events_chain_format" CHECK ("market"."chain_events"."chain" ~ '^eip155:[1-9][0-9]*$'),
	CONSTRAINT "chain_events_block_hash_format" CHECK ("market"."chain_events"."block_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_events_tx_hash_format" CHECK ("market"."chain_events"."tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_events_emitter_format" CHECK ("market"."chain_events"."emitter" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "chain_events_log_index_positive" CHECK ("market"."chain_events"."log_index" >= 0),
	CONSTRAINT "chain_events_block_number_positive" CHECK ("market"."chain_events"."block_number" >= 0),
	CONSTRAINT "chain_events_abi_hash_format" CHECK ("market"."chain_events"."abi_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "market"."chain_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "market"."tokens" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "launch"."drafts" ADD CONSTRAINT "drafts_owner_id_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."drafts" ADD CONSTRAINT "drafts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."metadata_versions" ADD CONSTRAINT "metadata_versions_author_id_profiles_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "identity"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch"."transaction_requests" ADD CONSTRAINT "transaction_requests_owner_id_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_owner_idx" ON "launch"."drafts" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_versions_hash_idx" ON "launch"."metadata_versions" USING btree ("chain","token","content_hash");--> statement-breakpoint
CREATE INDEX "metadata_versions_token_idx" ON "launch"."metadata_versions" USING btree ("chain","token","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "launch"."outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_event_topic_idx" ON "launch"."outbox" USING btree ("event_chain","event_block_hash","event_tx_hash","event_log_index","topic") WHERE "launch"."outbox"."event_chain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "presets_config_hash_idx" ON "launch"."presets" USING btree ("chain","config_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_requests_idempotency_idx" ON "launch"."transaction_requests" USING btree ("owner_id","idempotency_key") WHERE "launch"."transaction_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "transaction_requests_tx_idx" ON "launch"."transaction_requests" USING btree ("chain","tx_hash");--> statement-breakpoint
CREATE INDEX "chain_blocks_height_idx" ON "market"."chain_blocks" USING btree ("chain","number");--> statement-breakpoint
CREATE INDEX "chain_events_emitter_idx" ON "market"."chain_events" USING btree ("chain","emitter","block_number");--> statement-breakpoint
CREATE INDEX "chain_events_name_idx" ON "market"."chain_events" USING btree ("chain","event_name","block_number");
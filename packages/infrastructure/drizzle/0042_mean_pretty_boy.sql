CREATE TABLE "launch"."indexer_admission" (
	"chain" text PRIMARY KEY NOT NULL,
	"owner" uuid,
	"expires_at" timestamp with time zone,
	"day" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "indexer_admission_requests" CHECK ("launch"."indexer_admission"."requests">=0)
);
--> statement-breakpoint
ALTER TABLE "launch"."indexer_admission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market"."kuru_graduations" (
	"chain" text NOT NULL,
	"token" text NOT NULL,
	"market" text NOT NULL,
	"vault" text NOT NULL,
	"account_id" numeric(78, 0) NOT NULL,
	"venue_hash" text NOT NULL,
	"adapter" text NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"positions" jsonb NOT NULL,
	"token_reserved" numeric(78, 0) NOT NULL,
	"quote_reserved" numeric(78, 0) NOT NULL,
	"token_remainder" numeric(78, 0) NOT NULL,
	"quote_remainder" numeric(78, 0) NOT NULL,
	CONSTRAINT "kuru_graduations_chain_token_block_hash_pk" PRIMARY KEY("chain","token","block_hash"),
	CONSTRAINT "kuru_graduations_network" CHECK ("market"."kuru_graduations"."chain"='eip155:10143'),
	CONSTRAINT "kuru_graduations_addresses" CHECK ("market"."kuru_graduations"."token" ~ '^0x[0-9a-f]{40}$' AND "market"."kuru_graduations"."market" ~ '^0x[0-9a-f]{40}$' AND "market"."kuru_graduations"."vault" ~ '^0x[0-9a-f]{40}$' AND "market"."kuru_graduations"."adapter" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "kuru_graduations_hashes" CHECK ("market"."kuru_graduations"."block_hash" ~ '^0x[0-9a-f]{64}$' AND "market"."kuru_graduations"."tx_hash" ~ '^0x[0-9a-f]{64}$' AND "market"."kuru_graduations"."venue_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "kuru_graduations_reserves" CHECK ("market"."kuru_graduations"."token_reserved">0 AND "market"."kuru_graduations"."quote_reserved">0 AND "market"."kuru_graduations"."token_remainder">=0 AND "market"."kuru_graduations"."quote_remainder">=0)
);
--> statement-breakpoint
ALTER TABLE "market"."kuru_graduations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "market"."pools" DROP CONSTRAINT "pools_venue";--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD COLUMN "rpc_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "market"."pools" ADD CONSTRAINT "pools_venue" CHECK ("market"."pools"."venue" in ('pickler_curve', 'pons', 'uniswap_v4', 'kuru_passive'));
--> statement-breakpoint
REVOKE ALL ON launch.indexer_admission,market.kuru_graduations FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON launch.indexer_admission,market.kuru_graduations FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON launch.indexer_admission,market.kuru_graduations FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT ALL ON launch.indexer_admission,market.kuru_graduations TO service_role; END IF;
END $$;

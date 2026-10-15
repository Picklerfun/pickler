CREATE TABLE "market"."uniswap_graduations" (
	"chain" text NOT NULL,
	"token" text NOT NULL,
	"pool_manager" text NOT NULL,
	"locker" text NOT NULL,
	"pool_id" text NOT NULL,
	"position_id" numeric(78, 0) NOT NULL,
	"liquidity" numeric(78, 0) NOT NULL,
	"pool_key" jsonb NOT NULL,
	"venue_hash" text NOT NULL,
	"adapter" text NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"token_used" numeric(78, 0) NOT NULL,
	"quote_used" numeric(78, 0) NOT NULL,
	"token_remainder" numeric(78, 0) NOT NULL,
	"quote_remainder" numeric(78, 0) NOT NULL,
	CONSTRAINT "uniswap_graduations_chain_token_block_hash_pk" PRIMARY KEY("chain","token","block_hash"),
	CONSTRAINT "uniswap_graduations_network" CHECK ("market"."uniswap_graduations"."chain"='eip155:10143'),
	CONSTRAINT "uniswap_graduations_addresses" CHECK ("market"."uniswap_graduations"."token" ~ '^0x[0-9a-f]{40}$' AND "market"."uniswap_graduations"."pool_manager" ~ '^0x[0-9a-f]{40}$' AND "market"."uniswap_graduations"."locker" ~ '^0x[0-9a-f]{40}$' AND "market"."uniswap_graduations"."adapter" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "uniswap_graduations_hashes" CHECK ("market"."uniswap_graduations"."pool_id" ~ '^0x[0-9a-f]{64}$' AND "market"."uniswap_graduations"."block_hash" ~ '^0x[0-9a-f]{64}$' AND "market"."uniswap_graduations"."tx_hash" ~ '^0x[0-9a-f]{64}$' AND "market"."uniswap_graduations"."venue_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "uniswap_graduations_amounts" CHECK ("market"."uniswap_graduations"."position_id">0 AND "market"."uniswap_graduations"."liquidity">0 AND "market"."uniswap_graduations"."token_used">0 AND "market"."uniswap_graduations"."quote_used">0 AND "market"."uniswap_graduations"."token_remainder">=0 AND "market"."uniswap_graduations"."quote_remainder">=0)
);
--> statement-breakpoint
ALTER TABLE "market"."uniswap_graduations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE market.uniswap_graduations FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE market.uniswap_graduations FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE market.uniswap_graduations FROM authenticated; END IF;
END $$;

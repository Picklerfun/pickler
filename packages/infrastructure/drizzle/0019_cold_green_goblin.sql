ALTER TABLE "agents"."agent_profiles" ADD COLUMN "venue" text DEFAULT 'predictions' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD COLUMN "vibe" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD COLUMN "voice" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD COLUMN "decides" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD COLUMN "wrong" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_venue" CHECK ("agents"."agent_profiles"."venue" in ('predictions', 'perps', 'both'));--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_vibe_length" CHECK (char_length("agents"."agent_profiles"."vibe") <= 120);--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_voice_length" CHECK (char_length("agents"."agent_profiles"."voice") <= 120);--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_decides_length" CHECK (char_length("agents"."agent_profiles"."decides") <= 280);--> statement-breakpoint
ALTER TABLE "agents"."agent_profiles" ADD CONSTRAINT "agent_profiles_wrong_length" CHECK (char_length("agents"."agent_profiles"."wrong") <= 280);
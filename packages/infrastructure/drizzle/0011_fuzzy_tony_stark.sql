CREATE TABLE "identity"."siwe_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."siwe_nonces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "siwe_nonces_expiry_idx" ON "identity"."siwe_nonces" USING btree ("expires_at");
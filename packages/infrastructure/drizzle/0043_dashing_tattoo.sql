ALTER TABLE "launch"."operations" DROP CONSTRAINT "operations_status";--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD COLUMN "sender" text;--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD COLUMN "transaction_nonce" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "operations_master_nonce" ON "launch"."operations" USING btree ("chain","sender","transaction_nonce") WHERE "launch"."operations"."status" IN ('awaiting_signature','signing','signed','submitting','confirming','included','unknown');--> statement-breakpoint
ALTER TABLE "launch"."operations" ADD CONSTRAINT "operations_status" CHECK ("launch"."operations"."status" IN ('preparing','awaiting_signature','signing','signed','submitting','confirming','included','finalized','failed','cancelled','unknown'));
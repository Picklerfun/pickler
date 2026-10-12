ALTER TABLE "pickler"."advice_payments" ADD COLUMN "payee" text;--> statement-breakpoint
ALTER TABLE "pickler"."advice_payments" ADD COLUMN "creator_amount_micro_ausd" bigint;--> statement-breakpoint
ALTER TABLE "pickler"."advice_payments" ADD COLUMN "protocol_amount_micro_ausd" bigint;
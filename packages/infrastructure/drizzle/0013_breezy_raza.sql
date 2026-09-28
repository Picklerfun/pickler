CREATE TABLE "pickler"."perps_paper_observations" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"document" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "perps_paper_observations_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_observations" ADD CONSTRAINT "perps_paper_observations_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;
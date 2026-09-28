CREATE TABLE "pickler"."perps_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"network" text NOT NULL,
	"document" jsonb NOT NULL,
	"owner" text,
	"expires_at" bigint
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_studies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_study_events" (
	"study_id" text NOT NULL,
	"key" text NOT NULL,
	"at" bigint NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "perps_study_events_study_id_key_pk" PRIMARY KEY("study_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_study_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_study_rounds" (
	"study_id" text NOT NULL,
	"key" text NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "perps_study_rounds_study_id_key_pk" PRIMARY KEY("study_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_study_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perps_study_events" ADD CONSTRAINT "perps_study_events_study_id_perps_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "pickler"."perps_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_study_rounds" ADD CONSTRAINT "perps_study_rounds_study_id_perps_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "pickler"."perps_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perps_study_scope" ON "pickler"."perps_studies" USING btree ("tenant_id","session_id","network");
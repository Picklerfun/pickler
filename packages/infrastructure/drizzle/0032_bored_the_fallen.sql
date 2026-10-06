CREATE TABLE "pickler"."studio_access_requests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."studio_access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."studio_access_requests" ADD CONSTRAINT "studio_access_requests_user_id_research_access_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "pickler"."research_access"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."studio_access_requests" ADD CONSTRAINT "studio_access_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;
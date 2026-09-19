CREATE TABLE "pickler"."budget_processed" (
	"agent_id" uuid NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "budget_processed_agent_id_key_pk" PRIMARY KEY("agent_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."budget_processed" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."budget_reservations" (
	"agent_id" uuid NOT NULL,
	"id" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "budget_reservations_agent_id_id_pk" PRIMARY KEY("agent_id","id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."budget_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."budget_state" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."budget_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."product_agents" (
	"product_agent_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"runtime_agent_id" text NOT NULL,
	"request_key" text NOT NULL,
	"request" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."product_agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."research_access" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."research_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."workspace_tenants" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."workspace_tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."budget_processed" ADD CONSTRAINT "budget_processed_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."budget_reservations" ADD CONSTRAINT "budget_reservations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."budget_state" ADD CONSTRAINT "budget_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."product_agents" ADD CONSTRAINT "product_agents_product_agent_id_agents_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "agents"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."product_agents" ADD CONSTRAINT "product_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."product_agents" ADD CONSTRAINT "product_agents_tenant_id_runtime_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","runtime_agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."workspace_tenants" ADD CONSTRAINT "workspace_tenants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_runtime_unique" ON "pickler"."product_agents" USING btree ("tenant_id","runtime_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_agent_request_unique" ON "pickler"."product_agents" USING btree ("workspace_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_tenant_unique" ON "pickler"."workspace_tenants" USING btree ("tenant_id");
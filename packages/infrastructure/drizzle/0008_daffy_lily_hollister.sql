ALTER TABLE "pickler"."budget_state" ALTER COLUMN "state" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_tenant_pair" ON "pickler"."workspace_tenants" USING btree ("workspace_id","tenant_id");
--> statement-breakpoint
ALTER TABLE "pickler"."product_agents" ADD CONSTRAINT "product_agents_workspace_id_tenant_id_workspace_tenants_workspace_id_tenant_id_fk" FOREIGN KEY ("workspace_id","tenant_id") REFERENCES "pickler"."workspace_tenants"("workspace_id","tenant_id") ON DELETE no action ON UPDATE no action;

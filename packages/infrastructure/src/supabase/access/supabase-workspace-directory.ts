// Ported from Relayer kits/signing/integrators/repositories/IntegratorRepository.ts (findById,
// findByUserId), core/auth/workspace-membership.util.ts and the membership lookup inside
// core/auth/guards/combined-auth.guard.ts (commit bb6bb1226e92).
// Tables: identity.workspaces (Relayer's integrators) and identity.workspace_members.

import { DataSourceUnavailableError, type Workspace, type WorkspaceDirectory } from "@pickler/core";
import type { SupabaseAdmin } from "../supabase-admin-client.js";

interface WorkspaceRow {
  id: string;
  name: string;
  owner_user_id: string;
  is_active: boolean;
  active_modules: string[];
}

const WORKSPACE_COLUMNS = "id, name, owner_user_id, is_active, active_modules";

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  userId: row.owner_user_id,
  isActive: row.is_active,
  activeModules: row.active_modules,
});

function unwrap<T>(result: { data: T; error: { message: string } | null }, source: string): T {
  if (result.error) {
    throw new DataSourceUnavailableError(`supabase.identity.${source}`, {
      cause: new Error(result.error.message),
    });
  }
  return result.data;
}

export function createSupabaseWorkspaceDirectory(db: SupabaseAdmin): WorkspaceDirectory {
  const workspaces = () => db.schema("identity").from("workspaces");
  const members = () => db.schema("identity").from("workspace_members");

  return {
    async findById(id) {
      const row = unwrap(
        await workspaces().select(WORKSPACE_COLUMNS).eq("id", id).maybeSingle<WorkspaceRow>(),
        "workspaces.findById",
      );
      return row && toWorkspace(row);
    },

    async findOwnedBy(userId) {
      const row = unwrap(
        await workspaces()
          .select(WORKSPACE_COLUMNS)
          .eq("owner_user_id", userId)
          .maybeSingle<WorkspaceRow>(),
        "workspaces.findOwnedBy",
      );
      return row && toWorkspace(row);
    },

    async findOldestMembership(userId) {
      const row = unwrap(
        await members()
          .select("workspace_id, role")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle<{ workspace_id: string; role: string }>(),
        "workspace_members.findOldest",
      );
      return row && { workspaceId: row.workspace_id, role: row.role };
    },

    async roleOf(userId, workspaceId) {
      const owner = unwrap(
        await workspaces()
          .select("owner_user_id")
          .eq("id", workspaceId)
          .maybeSingle<{ owner_user_id: string }>(),
        "workspaces.owner",
      );
      if (owner?.owner_user_id === userId) {
        return "admin";
      }
      const membership = unwrap(
        await members()
          .select("role")
          .eq("user_id", userId)
          .eq("workspace_id", workspaceId)
          .maybeSingle<{ role: string }>(),
        "workspace_members.role",
      );
      return membership?.role ?? null;
    },
  };
}

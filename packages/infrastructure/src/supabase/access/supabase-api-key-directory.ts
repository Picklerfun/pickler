// Ported from Relayer core/auth/repositories/ApiKeyRepository.ts (findByHash,
// findIntegratorIdByApiKeyId) (commit bb6bb1226e92). identity.api_keys carries workspace_id
// directly, so Relayer's integrator_keys join table is gone. A revoked key is inactive.

import { DataSourceUnavailableError, type ApiKeyDirectory } from "@pickler/core";
import type { SupabaseAdmin } from "../supabase-admin-client.js";

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  scopes: string[];
  allowed_cidrs: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export function createSupabaseApiKeyDirectory(db: SupabaseAdmin): ApiKeyDirectory {
  return {
    async findByHash(hash) {
      const { data, error } = await db
        .schema("identity")
        .from("api_keys")
        .select("id, workspace_id, scopes, allowed_cidrs, expires_at, revoked_at")
        .eq("hash", hash)
        .maybeSingle<ApiKeyRow>();
      if (error) {
        throw new DataSourceUnavailableError("supabase.identity.api_keys.findByHash", {
          cause: new Error(error.message),
        });
      }
      if (!data) {
        return null;
      }
      return {
        id: data.id,
        scopes: data.scopes,
        active: data.revoked_at === null,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
        allowedCidrs: data.allowed_cidrs,
        workspaceId: data.workspace_id,
        linkExpiresAt: null,
      };
    },
  };
}

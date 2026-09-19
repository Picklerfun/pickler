/** A row of `public.api_keys` joined with its `public.integrator_keys` link. */
export interface StoredApiKey {
  id: string;
  scopes: string[];
  active: boolean;
  expiresAt: Date | null;
  allowedCidrs: string[] | null;
  workspaceId: string | null;
  linkExpiresAt: Date | null;
}

export interface ApiKeyDirectory {
  /** Looks up by SHA-256 hash of the presented key; null when unknown. */
  findByHash(hash: string): Promise<StoredApiKey | null>;
}

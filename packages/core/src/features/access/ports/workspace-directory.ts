/** A row of `public.integrators`, the creator's workspace. */
export interface Workspace {
  id: string;
  name: string;
  /** Owner (`auth.users.id`); unique per workspace. */
  userId: string | null;
  isActive: boolean;
  activeModules: string[];
}

export interface WorkspaceDirectory {
  findById(id: string): Promise<Workspace | null>;
  findOwnedBy(userId: string): Promise<Workspace | null>;
  /** Oldest membership first, so resolution is deterministic. */
  findOldestMembership(
    userId: string,
  ): Promise<{ workspaceId: string; role: string | null } | null>;
  /** "admin" for the owner, the membership role (default "viewer") for members, null otherwise. */
  roleOf(userId: string, workspaceId: string): Promise<string | null>;
}

/**
 * What the home's Menu lets a person reach, and the one reason it gives when it does not: the
 * sections, which need an agent, and "+ New agent", which needs the workspace's permission, research
 * access and the unfunded-agent lock. The empty home's own "Create your first agent" reads the same
 * answer, so the button and the Menu never give two different reasons. Pure, and pinned in
 * `studio-landing.test.ts`.
 */

/** The hint on every section before the first agent exists (the "Pickler Studio Empty" canvas). */
export const NEEDS_AGENT = "After you create your agent";

export const VIEW_ONLY = "You can view this workspace but not create agents.";

export interface MenuAccess {
  /** Whether "+ New agent" is a link. */
  create: boolean;
  /** Why it is not, or "" when it is. */
  createNote: string;
  /** Whether the section rows can be opened. */
  sections: boolean;
  /** Why they cannot, or "" when they can. */
  sectionNote: string;
}

export function menuAccess({
  hasAgent,
  canManage,
  researchLock,
  fundLock,
}: {
  hasAgent: boolean;
  canManage: boolean;
  /** Why the workspace cannot create agents at all (research not enabled), or "". */
  researchLock: string;
  /** The unfunded-agent lock's note, or "" when another agent may be created. */
  fundLock: string;
}): MenuAccess {
  // Research first: the API's canManage is false whenever research is off, even for the owner,
  // so checking it first told an owner waiting on research that they were only a viewer.
  let createNote = "";
  if (researchLock) {
    createNote = researchLock;
  } else if (!canManage) {
    createNote = VIEW_ONLY;
  } else if (fundLock) {
    createNote = fundLock;
  }
  return {
    create: createNote === "",
    createNote,
    sections: hasAgent,
    sectionNote: hasAgent ? "" : NEEDS_AGENT,
  };
}

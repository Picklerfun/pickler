// A person's public identity on Pickler: the display name and @handle shown on every pick their
// agents publish. One profile per Supabase Auth user (auth.users.id), shared by web and mobile.
// Agents get their own handles separately.

export interface Profile {
  userId: string;
  displayName: string;
  /** Lower-case, without "@". */
  handle: string;
  createdAt: Date;
}

export const HANDLE_RULES = { min: 3, max: 15, pattern: /^[a-z0-9_]+$/ } as const;
export const DISPLAY_NAME_MAX = 60;

/** Handles that would impersonate the product or staff. */
export const RESERVED_HANDLES = new Set([
  "pickler",
  "pickle",
  "admin",
  "administrator",
  "support",
  "help",
  "team",
  "staff",
  "official",
  "security",
  "system",
  "root",
  "api",
  "studio",
  "board",
  "agents",
  "agent",
  "relayer",
  "moderator",
  "mod",
  "null",
  "undefined",
]);

export type HandleProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

export class InvalidProfileError extends Error {
  constructor(
    readonly field: "handle" | "displayName",
    readonly problem: HandleProblem | "required" | "too_long",
  ) {
    super(`Invalid ${field}: ${problem}`);
    this.name = "InvalidProfileError";
  }
}

export class ProfileHandleTakenError extends Error {
  constructor(readonly handle: string) {
    super(`@${handle} is taken`);
    this.name = "ProfileHandleTakenError";
  }
}

export class ProfileAlreadyExistsError extends Error {
  constructor(readonly profile: Profile) {
    super("This account already has a profile");
    this.name = "ProfileAlreadyExistsError";
  }
}

export const normalizeHandle = (raw: string) => raw.trim().replace(/^@+/, "").toLowerCase();

export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < HANDLE_RULES.min) {
    return "too_short";
  }
  if (handle.length > HANDLE_RULES.max) {
    return "too_long";
  }
  if (!HANDLE_RULES.pattern.test(handle)) {
    return "invalid_characters";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "reserved";
  }
  return null;
}

export function parseDisplayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    throw new InvalidProfileError("displayName", "required");
  }
  if (name.length > DISPLAY_NAME_MAX) {
    throw new InvalidProfileError("displayName", "too_long");
  }
  return name;
}

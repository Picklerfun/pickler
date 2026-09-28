// /api/v1/profile and /api/v1/handles/:handle/availability. The values below mirror the business
// rules in core so the screen can tell somebody their handle is too short while they type, rather
// than once per keystroke over the network. Core stays authoritative: POST /v1/profile validates
// against it and refuses, so a client briefly out of step shows imperfect guidance and cannot let
// a bad handle through.
//
// The two packages cannot import each other — eslint.config.mjs forbids it in both directions — so
// this is a mirror in the sense `applications.ts` and `markets.ts` already use. Unlike those, it is
// guarded: workers/api sees both sides and workers/api/test/handle-rules.test.ts asserts they are
// equal, so a change to core that is not made here fails a test rather than drifting quietly.

export interface HandleRules {
  min: number;
  max: number;
  pattern: RegExp;
}

export const HANDLE_RULES: HandleRules = {
  min: 3,
  max: 15,
  pattern: /^[a-z0-9_]+$/,
};

export const DISPLAY_NAME_MAX = 60;

/** Handles that would impersonate the product or staff. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
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

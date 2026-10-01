/**
 * The studio's words for the API's error codes. Kept apart from the transport (`../api.ts`), which
 * reads a session and cannot be imported by a test; the copy is pinned in `studio-status.test.ts`.
 */
const messages: Record<string, string> = {
  NOT_READY:
    "Scheduling requires a connection check and a successful manual research with the current settings.",
  ADMISSIONS_PAUSED:
    "The operator has paused new research. Your existing results remain available.",
  RESEARCH_ACCESS_DENIED: "Research access is pending or you do not own this workspace.",
  CONFLICT:
    "The configuration changed or this handle is already taken. Reload before saving again.",
  QUOTA:
    "This agent has reached its research allowance. Try again after the rolling window clears.",
  PLUGIN_NOT_CONFIGURED: "An enabled plugin needs operator credentials before it can run.",
  PLUGIN_DISABLED: "A capability required for this action is disabled.",
  UNAUTHORIZED: "Your session has expired. Sign in again.",
  NOT_FUNDED: "Fund its wallet first · min. 10 AUSD.",
  UNFUNDED_AGENT: "Fund your other agent first. One unfunded agent at a time.",
  DRAFT_LIMIT: "At most 3 drafts at a time.",
  BALANCES_UNAVAILABLE: "Balances and deposits are not available here yet.",
  INVALID_INPUT: "Check the fields. Select at least one sport and valid limits.",
  INVALID_BRIEF: "Check the brief: a section is empty, too long or has too many lines.",
  PREVIEW_RATE_LIMITED: "Five paper runs an hour. The next one opens soon.",
  PREVIEW_UNAVAILABLE: "Paper runs are not available here yet.",
  RUN_STALE: "The brief changed since the run. Run it again, then create.",
  HANDLE_TAKEN: "That handle is taken. Change the name.",
  PREVIEW_UNUSABLE: "That paper run can't be used any more. Run it again, then create.",
  DAILY_CAP_REACHED: "Today's paper trades reached its daily cap.",
};
/** The studio's words for a code, when it has any. */
export const knownMessage = (code: string): string | undefined => messages[code];

/** The studio's words for a code, or the server's behind "Request failed" for one it has none for. */
export const messageFor = (code: string, serverMessage: string | undefined): string =>
  messages[code] ?? `Request failed: ${serverMessage ?? code}`;

/**
 * The studio's words for the API's error codes. Kept apart from the transport (`../api.ts`), which
 * reads a session and cannot be imported by a test; the copy is pinned in `studio-status.test.ts`.
 */
const UNDERFUNDED = "Fund its wallet with at least 10 AUSD and 0.5 MON first.";
const WALLETS_UNREADABLE = "We can't read the wallets right now. Try again in a moment.";

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
  // Not the same as balances_unavailable: this one says the deposit feature is switched off.
  BALANCES_UNAVAILABLE: "Balances and deposits are not available here yet.",
  INVALID_INPUT: "Check the fields. Select at least one sport and valid limits.",
  INVALID_BRIEF: "Check the brief: a section is empty, too long or has too many lines.",
  PREVIEW_RATE_LIMITED: "Five paper runs an hour. The next one opens soon.",
  PREVIEW_UNAVAILABLE: "Paper runs are not available here yet.",
  RUN_STALE: "The brief changed since the run. Run it again, then create.",
  HANDLE_TAKEN: "That handle is taken. Change the name or the handle.",
  PREVIEW_UNUSABLE: "That paper run can't be used any more. Run it again, then create.",
  // The studio routes send WALLET_UNDERFUNDED; the signing routes (policies prepare) send the
  // lowercase wallet_underfunded and balances_unavailable in their envelope.
  WALLET_UNDERFUNDED: UNDERFUNDED,
  wallet_underfunded: UNDERFUNDED,
  WALLET_ASSIGNED: "That wallet already belongs to an agent.",
  POLICIES_MISSING: "Sign its caps first.",
  INSUFFICIENT_FUNDS: "The wallet doesn't hold that much.",
  TRANSFER_ALREADY_RECORDED: "That transfer already went through.",
  INVALID_TRANSFER: "That transfer can't be made.",
  INSUFFICIENT_GAS: "Not enough MON to pay the network fee.",
  WALLETS_UNAVAILABLE: WALLETS_UNREADABLE,
  balances_unavailable: WALLETS_UNREADABLE,
  WALLET_NOT_FOUND: "That wallet isn't yours, or it no longer exists.",
  FEE_TOO_HIGH: "The network fee changed. Prepare it again.",
  NONCE_GAP: "This transfer is out of date. Prepare it again.",
  NOT_SENDABLE: "This wallet can't send that transfer. Check its AUSD and MON.",
  DAILY_CAP_REACHED: "Today's paper trades reached its daily cap.",
};
/** The studio's words for a code, when it has any. */
export const knownMessage = (code: string): string | undefined => messages[code];

/** The studio's words for a code, or the server's behind "Request failed" for one it has none for. */
export const messageFor = (code: string, serverMessage: string | undefined): string =>
  messages[code] ?? `Request failed: ${serverMessage ?? code}`;

/**
 * The studio's words for the API's error codes. Kept apart from the transport (`../api.ts`), which
 * reads a session and cannot be imported by a test; the copy is pinned in `studio-status.test.ts`.
 */
const UNDERFUNDED = "Fund its wallet with at least 10 AUSD and 0.5 MON first.";
const WALLETS_UNREADABLE = "We can't read the wallets right now. Try again in a moment.";
/** The draft limit in words, said by the 409 and by the "+ New agent" entries it closes. */
export const DRAFT_LIMIT_NOTE = "At most 3 drafts at a time.";

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
  DRAFT_LIMIT: DRAFT_LIMIT_NOTE,
  // Not the same as balances_unavailable: this one says the deposit feature is switched off.
  BALANCES_UNAVAILABLE: "Balances and deposits are not available here yet.",
  INVALID_INPUT: "Check the fields: a value is missing or out of range.",
  INVALID_BRIEF: "Check the brief: a section is empty, too long or has too many lines.",
  HANDLE_TAKEN: "That handle is taken. Change the name or the handle.",
  // The studio routes send WALLET_UNDERFUNDED; the signing routes (policies prepare) send the
  // lowercase wallet_underfunded and balances_unavailable in their envelope.
  WALLET_UNDERFUNDED: UNDERFUNDED,
  wallet_underfunded: UNDERFUNDED,
  WALLET_ASSIGNED: "That wallet already belongs to an agent.",
  // The signing routes' word for the same refusal (policies for a linked wallet).
  wallet_assigned: "That wallet already belongs to an agent.",
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
  // The wallet routes' and the drafts route's passkey and backend failures.
  INVALID_SIGNED_ACTIVITY: "That passkey signature doesn't match what was prepared. Try again.",
  SIGNED_ACTIVITY_REJECTED: "Your passkey's signature was refused. Nothing was sent. Try again.",
  SIGNING_UNAVAILABLE: "The signing service isn't answering. Try again in a moment.",
  NO_CUSTODY_ACCOUNT: "Your account has no wallet yet. Finish signing up with your passkey first.",
  SIGNED_TX_MISMATCH: "The signed transfer didn't match what you approved, so it wasn't sent.",
  INTERNAL_OR_PROVIDER_FAILURE: "Something went wrong on our side. Try again in a moment.",
};
/** The studio's words for a code, when it has any. */
export const knownMessage = (code: string): string | undefined => messages[code];

/** The studio's words for a code, or the server's behind "Request failed" for one it has none for. */
export const messageFor = (code: string, serverMessage: string | undefined): string =>
  messages[code] ?? `Request failed: ${serverMessage ?? code}`;

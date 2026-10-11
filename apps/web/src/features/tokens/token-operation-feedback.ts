/** Only reviewed codes become user copy; provider text never reaches the launch card. */
const operationMessages: Record<string, string> = {
  RPC_UNAVAILABLE: "The testnet connection is unavailable. Try again when it recovers.",
  RPC_BUDGET_EXHAUSTED: "This attempt reached its network request limit. Start a new preparation.",
  GAS_LIMIT_EXCEEDED:
    "The estimated gas exceeds the launch limit. No transaction was signed. Pickler needs to review the limit before you retry.",
  INSUFFICIENT_GAS_BALANCE: "Your master wallet needs more testnet MON to cover gas.",
  SIMULATION_REJECTED:
    "The contract rejected the transaction preview. No transaction was signed. Pickler needs to review this launch.",
  METADATA_UNAVAILABLE:
    "The token image and metadata could not be saved. Your draft is kept. Try preparing again.",
  APPROVAL_REQUIRED: "Approve the amount first, then review the trade.",
  APPROVAL_NOT_REQUIRED: "This amount is already approved. Review the trade.",
  INSUFFICIENT_TOKEN_BALANCE: "The master wallet does not have enough of the input token.",
  CURVE_CLOSED: "The curve is complete; no more curve trades are available.",
  TRADE_TOO_SMALL: "This amount produces no output. Enter a larger amount.",
  EXCEEDS_CURVE_INVENTORY:
    "This purchase exceeds the remaining sale inventory. Enter a smaller amount.",
  PREFLIGHT_REJECTED:
    "The transaction no longer passes its checks. No transaction was signed. Prepare it again.",
  AUTHORIZATION_EXPIRED: "This preparation expired. Prepare again for a new passkey request.",
  SIGNATURE_REJECTED:
    "The signing service rejected this request. No transaction was sent. Your draft is kept; prepare again.",
  TRANSACTION_REVERTED:
    "The transaction was included but reverted. The token was not launched; gas may have been charged.",
  CONTROLLED_FAILURE: "Preview preparation failed. No transaction was sent. Your draft is kept.",
};
export function tokenOperationErrorMessage(code: string | null, sent: boolean): string {
  return (
    operationMessages[code ?? ""] ??
    (sent
      ? "The operation failed. Check its transaction status before trying again."
      : "The operation could not be prepared. No transaction was signed or sent. Your draft is kept.")
  );
}
export function tokenRequestErrorMessage(code: string, phase?: string): string {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "Your session expired. Sign in again; your draft is kept.",
    TOKEN_OWNER_REQUIRED: "Only this agent’s owner can manage its token.",
    TOKEN_DRAFT_CONFLICT:
      "Another attempt or a newer draft is already saved. Refresh status before trying again.",
    TOKEN_IDEMPOTENCY_CONFLICT:
      "This request belongs to a different saved draft. Refresh status before trying again.",
    TOKEN_AUTHORIZATION_EXPIRED: "This preparation expired. Refresh status and prepare again.",
    TOKEN_LAUNCH_BLOCKED:
      "Launch preparation is currently blocked. Refresh status to check the requirements.",
    TOKEN_UNAVAILABLE: "Launch preparation is temporarily unavailable. Your draft is kept.",
  };
  if (messages[code]) {
    return messages[code];
  }
  if (phase === "check") {
    return "Could not check transaction status. The saved state is shown. Try Check status again.";
  }
  if (phase === "refresh") {
    return "Could not refresh the saved status. Your draft is kept. Try again when the connection recovers.";
  }
  return "The request could not be confirmed. Refresh status before trying again; your draft is kept.";
}

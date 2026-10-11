import type { TokenOperationDto } from "@pickler/api-schema";

/** Presentation only; absence of a hash never proves a signature was not requested. */
export function tokenOperationStatus(operation: TokenOperationDto) {
  const status = operation.status;
  if (status === "unknown") {
    if (operation.txHash) {
      return {
        title: "Submission status unknown",
        description:
          "The send response was lost. Check this transaction on-chain before any further action.",
        canCheck: true,
        checked: "The transaction has no confirmed receipt yet. Nothing was sent again.",
      };
    }
    if (operation.activityId) {
      return {
        title: "Waiting for signature result",
        description:
          "The signing service has not returned the signed transaction. Check status reads the same signature without sending it.",
        canCheck: true,
        checked: "The signature is still pending. No transaction hash is available yet.",
      };
    }
    return {
      title: "Signature status unavailable",
      description:
        "The signing response could not be recovered. No transaction hash is recorded. Pickler needs to review this attempt before another launch.",
      canCheck: false,
      checked: "This attempt still needs review. No new signature or transaction was requested.",
    };
  }
  if (status === "failed") {
    let title = "Could not complete";
    if (operation.error === "SIGNATURE_REJECTED") {
      title = "Signature rejected";
    } else if (!operation.activityId && !operation.txHash) {
      title = "Preparation failed";
    }
    return {
      title,
      description: "",
      checked: "The attempt failed. Review the message below.",
      canCheck: false,
    };
  }
  const messages = {
    preparing: [
      "Preparing",
      "Checking the transaction before your signature request.",
      "Preparation is still in progress.",
    ],
    awaiting_signature: [
      "Awaiting signature",
      "Review the details, then approve with your passkey. Nothing has been sent.",
      "Ready for your passkey.",
    ],
    signing: [
      "Waiting for signature result",
      "The signing request is in progress. A transaction hash appears once the signed transaction is recovered.",
      "The signing request is still in progress.",
    ],
    signed: [
      "Ready to send",
      "Your signature is saved. Submit this same transaction to send it to the network.",
      "The signature is saved; the transaction has not been sent by this flow.",
    ],
    submitting: [
      "Sending transaction",
      "Waiting for the network response. Checking status never sends it again.",
      "The send response is still pending.",
    ],
    confirming: [
      "Waiting for confirmation",
      "The transaction was sent. Check status to look for its receipt.",
      "No confirmed receipt yet. Nothing was sent again.",
    ],
    included: [
      "Included on-chain",
      "The transaction is in a block. Waiting for final confirmation.",
      "Included on-chain; final confirmation is still pending.",
    ],
    finalized: [
      "Transaction confirmed",
      "The transaction is confirmed on-chain.",
      "Confirmed on-chain.",
    ],
    cancelled: [
      "Cancelled",
      "Preparation cancelled. Your draft is kept.",
      "Preparation is cancelled.",
    ],
  } as const;
  const [title, description, checked] = messages[status];
  return {
    title,
    description,
    checked,
    canCheck: ["preparing", "signing", "signed", "submitting", "confirming", "included"].includes(
      status,
    ),
  };
}

export function tokenStatusCheckFeedback(operation: TokenOperationDto) {
  return tokenOperationStatus(operation).checked;
}

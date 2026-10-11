import test from "node:test";
import assert from "node:assert/strict";
import type { TokenOperationDto } from "@pickler/api-schema";
import {
  tokenOperationStatus,
  tokenStatusCheckFeedback,
} from "../src/features/tokens/token-operation-status";
import { tokenRequestErrorMessage } from "../src/features/tokens/token-operation-feedback";
const operation: TokenOperationDto = {
  id: "10000000-0000-4000-8000-000000000001",
  action: "launch",
  version: 1,
  status: "unknown",
  activityId: null,
  txHash: null,
  blockHash: null,
  error: "RECONCILIATION_REQUIRED",
  deadline: "9999999999",
  transaction: null,
};

test("missing launch signing identity offers bounded reconciliation, never a fake confirmation", () => {
  const view = tokenOperationStatus(operation);
  assert.equal(view.title, "Signature status unavailable");
  assert.equal(view.canCheck, true);
  assert.match(view.description, /authorization expires/);
  assert.doesNotMatch(view.description, /not signed|not sent|confirmed on-chain/);
  assert.match(tokenStatusCheckFeedback(operation), /remains blocked/);
  assert.equal(tokenOperationStatus({ ...operation, action: "buy" }).canCheck, false);
});

test("a pending signature and uncertain broadcast explain different explicit checks", () => {
  const signing = { ...operation, activityId: "activity" };
  assert.equal(tokenOperationStatus(signing).title, "Waiting for signature result");
  assert.match(tokenOperationStatus(signing).description, /without sending it/);
  assert.equal(tokenOperationStatus(signing).canCheck, true);
  assert.match(tokenStatusCheckFeedback(signing), /No transaction hash/);
  const sending = { ...signing, txHash: "0x" + "a".repeat(64) };
  assert.equal(tokenOperationStatus(sending).title, "Submission status unknown");
  assert.match(tokenStatusCheckFeedback(sending), /Nothing was sent again/);
});

test("signature, receipt and finality progress remain distinct, including unchanged checks", () => {
  const awaiting = { ...operation, status: "awaiting_signature" as const };
  assert.equal(tokenOperationStatus(awaiting).canCheck, false);
  assert.match(tokenOperationStatus(awaiting).description, /passkey/);
  const states = [
    ["signed", "Ready to send"],
    ["confirming", "Waiting for confirmation"],
    ["included", "Included on-chain"],
    ["finalized", "Transaction confirmed"],
  ] as const;
  for (const [status, title] of states) {
    const value = { ...operation, status };
    assert.equal(tokenOperationStatus(value).title, title);
    assert.ok(tokenStatusCheckFeedback(value).length > 0);
  }
  assert.equal(
    tokenOperationStatus({ ...operation, status: "failed", error: "SIGNATURE_REJECTED" }).title,
    "Signature rejected",
  );
});

test("failed reads explain the failed action without replacing the saved chain state or leaking prose", () => {
  const detail = "Private provider response";
  assert.match(tokenRequestErrorMessage(detail, "check"), /Could not check transaction status/);
  assert.match(tokenRequestErrorMessage(detail, "refresh"), /Could not refresh the saved status/);
  assert.doesNotMatch(tokenRequestErrorMessage(detail, "check"), /Private provider/);
  assert.match(tokenRequestErrorMessage("UNAUTHORIZED", "check"), /session expired/);
});

test("canonical expiration explains the safe new preparation without claiming a transaction receipt", () => {
  const expired = { ...operation, status: "failed" as const, error: "EXPIRED_LAUNCH_NOT_CREATED" };
  assert.equal(tokenOperationStatus(expired).title, "Launch attempt expired");
  assert.match(tokenStatusCheckFeedback(expired), /No token was created by this attempt/);
});

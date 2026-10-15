"use client";
import { useState } from "react";
import { Button, Field, Input } from "@pickler/ui";
import type { Agent } from "../api";
import type { PerplExecution } from "./use-execution";
import { TransactionLinks } from "./receipts";
import { ExistingPerplKey } from "./existing-key";
import styles from "./execution.module.css";

const setupLabels = {
  approve: "Approve collateral for Perpl",
  create_account: "Create and fund the Perpl account",
  deposit: "Deposit collateral in Perpl",
  forwarding: "Enable trading for this account",
  enroll: "Authorize this agent's trading key",
};
export function PerplAccountSetup({
  execution,
  agent,
  canManage,
  funding,
  onBack,
  onLimits,
}: {
  execution: PerplExecution;
  agent: Agent;
  canManage: boolean;
  funding: boolean;
  onBack: () => void;
  onLimits?: (() => void) | undefined;
}) {
  const [collateral, setCollateral] = useState<string | null>(null);
  const state = execution.state;
  if (!state) {
    return null;
  }
  const minimumRequirement = state.setupRequired
    ? state.requirements?.minimumAccountAusd
    : state.requirements?.minimumDepositAusd;
  const minimumCollateral = minimumRequirement?.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const selectedCollateral = collateral ?? minimumCollateral ?? "100";
  const collateralExceedsDailyLimit = Number(selectedCollateral) > (agent.spend?.perDayAusd ?? 0);
  const setup = state.setup.at(-1);
  const active =
    !!state.session && ["active", "paused", "stopping", "frozen"].includes(state.session.status);
  const disabled = execution.busy || execution.preview || !canManage;
  const preparePending = !!setup && !["confirmed", "failed"].includes(setup.status);
  return (
    <div className={styles.copy}>
      {state.setupRequired && !preparePending && (
        <ExistingPerplKey
          key={`${agent.productId ?? agent.id}:${state.address ?? ""}`}
          address={state.address}
          disabled={disabled || active}
          busy={execution.pendingAction === "connect"}
          connect={execution.connectKey}
        />
      )}
      {state.setupEnabled === false && state.setupRequired && !preparePending ? (
        <p className={styles.note}>
          Automatic account setup is unavailable. Connect an existing Perpl key for this wallet to
          continue.
        </p>
      ) : state.setupRequired || funding || preparePending ? (
        <>
          <Field label="Collateral · AUSD">
            <Input
              inputMode="decimal"
              value={selectedCollateral}
              onChange={(e) => setCollateral(e.target.value)}
              disabled={disabled || preparePending}
            />
          </Field>
          <p className={styles.note}>
            Daily collateral limit: {agent.spend?.perDayAusd ?? 0} AUSD. A new account also requires
            Perpl&apos;s minimum deposit.
          </p>
          {minimumCollateral && (
            <p className={styles.note}>
              Perpl minimum: {minimumCollateral} AUSD. Maximum per deposit:{" "}
              {state.requirements?.maximumCollateralAusd
                .replace(/(\.\d*?)0+$/, "$1")
                .replace(/\.$/, "")}{" "}
              AUSD.
            </p>
          )}
          {collateralExceedsDailyLimit && (
            <p className={styles.error} role="alert">
              Set this agent&apos;s daily limit to at least {selectedCollateral} AUSD before
              preparing this deposit.
            </p>
          )}
          {onLimits && (
            <Button variant="secondary" disabled={disabled || preparePending} onClick={onLimits}>
              Edit agent limits
            </Button>
          )}
          {setup && setup.status !== "confirmed" && setup.status !== "failed" ? (
            <div className={styles.copy}>
              <strong>{setupLabels[setup.kind]}</strong>
              {setup.kind === "enroll" && state.keyExpiresAt && (
                <p className={styles.note}>
                  Trading permission expires{" "}
                  {new Date(state.keyExpiresAt).toISOString().slice(0, 10)}.
                </p>
              )}
              <p className={styles.note}>
                {setup.kind === "enroll"
                  ? "Allow reading and trading only. This key cannot withdraw your funds."
                  : setup.kind === "forwarding"
                    ? "Allow Perpl to forward orders for this account."
                    : `${setup.collateralAusd} AUSD · authorized with your passkey.`}
              </p>
              {setup.status === "awaiting_signature" ? (
                <Button
                  variant="primary"
                  disabled={disabled}
                  onClick={() => void execution.authorize()}
                >
                  {execution.busy ? "Waiting for authorization…" : "Authorize with passkey"}
                </Button>
              ) : (
                <p className={styles.note} role="status">
                  Checking this account step. Its authorization will not be repeated.
                </p>
              )}
              {setup.txHash && (
                <TransactionLinks hashes={[setup.txHash]} preview={execution.preview} />
              )}
            </div>
          ) : (
            <Button
              variant="primary"
              disabled={
                disabled ||
                !state.admissionsEnabled ||
                state.setupEnabled === false ||
                collateralExceedsDailyLimit
              }
              onClick={() => void execution.prepare(selectedCollateral)}
            >
              {execution.busy
                ? "Preparing…"
                : state.setupRequired
                  ? "Set up Perpl"
                  : "Prepare deposit"}
            </Button>
          )}
          {!state.setupRequired && !preparePending && (
            <Button variant="secondary" disabled={execution.busy} onClick={() => onBack()}>
              Back to trading
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}

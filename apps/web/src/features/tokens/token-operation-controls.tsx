"use client";
import { useRef, useState } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import {
  tokenOperationSchema,
  tokenOperationPreparedSchema,
  type TokenStateDto,
  type TokenOperationDto,
} from "@pickler/api-schema";
import { TokenTradeForm } from "./token-trade-form";
import simulatedQuotes from "./trade-quotes.json";
import { errorCode, studioApi } from "../studio/api";
import { tokenOperationErrorMessage, tokenRequestErrorMessage } from "./token-operation-feedback";
import { useStudioMemory } from "../studio/routing/memory";
import styles from "./token.module.css";
const progress = {
  launch: "Preparing launch…",
  prepare: "Preparing transaction…",
  sign: "Waiting for passkey…",
  submit: "Submitting transaction…",
  check: "Checking transaction status…",
  cancel: "Cancelling preparation…",
  refresh: "Refreshing saved status…",
} as const;
const labels: Record<TokenOperationDto["status"], string> = {
  preparing: "Preparing",
  awaiting_signature: "Awaiting signature",
  signing: "Awaiting signature",
  signed: "Ready to submit",
  submitting: "Confirming",
  confirming: "Confirming",
  included: "Confirming",
  finalized: "Transaction confirmed",
  failed: "Could not complete",
  cancelled: "Cancelled",
  unknown: "Check transaction status",
};
function newest(local: TokenOperationDto | null, server: TokenOperationDto): TokenOperationDto {
  return local?.id === server.id && local.version > server.version ? local : server;
}
function units(value: string, decimals: number) {
  const padded = value.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return padded.slice(0, -decimals) + (fraction ? "." + fraction : "");
}
export function TokenOperationControls({
  agentId,
  state,
  preview,
  enabled,
  draftSaved,
  onChange,
}: {
  agentId: string;
  state: TokenStateDto;
  preview: boolean;
  enabled: boolean;
  draftSaved: boolean;
  onChange: (s: TokenStateDto) => void;
}) {
  const memory = useStudioMemory(),
    scope = `${agentId}:token:operation`;
  const generation = memory.generation();
  const owned = () => memory.generation() === generation;
  const [operation, setOperation] = useState(() => {
    const remembered = memory.outcome<TokenOperationDto | null>(scope, null);
    const server = state.operation;
    return { server, value: server ? newest(remembered, server) : remembered };
  });
  const [activity, setActivity] = useState<
    ReturnType<typeof tokenOperationPreparedSchema.parse>["activity"]
  >(() => null);
  const [busy, setBusy] = useState<keyof typeof progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionLock = useRef(false);
  const current =
    state.operation && state.operation !== operation.server
      ? newest(operation.value, state.operation)
      : (operation.value ?? state.operation);
  function retain(value: TokenOperationDto, clearRequest = true) {
    if (!owned()) {
      return;
    }
    setOperation({ value, server: state.operation });
    memory.setOutcome(scope, value);
    if (clearRequest && ["failed", "cancelled", "finalized"].includes(value.status)) {
      memory.setOutcome(scope + ":request", null);
    }
  }
  const active = current && !["failed", "cancelled", "finalized"].includes(current.status);
  const url = `/agents/${agentId}/token/operations`;
  async function refresh() {
    const { tokenStateSchema } = await import("@pickler/api-schema");
    const latest = tokenStateSchema.parse(
      await studioApi(`/agents/${agentId}/token`, { signal: AbortSignal.timeout(15_000) }),
    );
    if (latest.operation) {
      retain(latest.operation, latest.operation.id !== current?.id);
    }
    if (owned()) {
      onChange(latest);
    }
  }
  async function action(phase: keyof typeof progress, work: () => Promise<void>) {
    if (actionLock.current || memory.busy(scope) || !owned()) {
      return;
    }
    actionLock.current = true;
    setBusy(phase);
    setError(null);
    memory.begin(scope);
    try {
      await work();
    } catch (caught) {
      let recovered: TokenOperationDto | null = null;
      if (!preview) {
        // Database-only recovery; no signing, provider polling or automatic resubmission.
        try {
          const { tokenStateSchema } = await import("@pickler/api-schema");
          const latest = tokenStateSchema.parse(
            await studioApi(`/agents/${agentId}/token`, { signal: AbortSignal.timeout(15_000) }),
          );
          recovered = latest.operation ?? null;
          if (recovered) {
            retain(recovered, recovered.id !== current?.id);
          }
          if (owned()) {
            onChange(latest);
          }
        } catch {
          // Retain the same idempotency key even when the saved status cannot be read.
        }
      }
      const recoveredFailure =
        recovered?.status === "failed" &&
        (recovered.id !== current?.id || (phase !== "launch" && phase !== "prepare"));
      if (owned()) {
        setError(recoveredFailure ? null : tokenRequestErrorMessage(errorCode(caught)));
      }
    } finally {
      if (owned()) {
        memory.end(scope);
      }
      actionLock.current = false;
      setBusy(null);
    }
  }
  async function prepare(
    kind: TokenOperationDto["action"],
    asset: "ausd" | "agent" = "ausd",
    trade?: { amount: string; slippageBps: number },
  ) {
    if (preview) {
      retain({
        id: "10000000-0000-4000-8000-000000000001",
        action: kind,
        version: 1,
        status: "awaiting_signature",
        activityId: null,
        txHash: null,
        blockHash: null,
        error: null,
        deadline: "9999999999",
        ...(trade
          ? {
              quote: {
                ...simulatedQuotes[kind === "sell" || kind === "approve_sell" ? "sell" : "buy"],
                side:
                  kind === "sell" || kind === "approve_sell" ? ("sell" as const) : ("buy" as const),
                approval: kind.startsWith("approve_"),
              },
            }
          : {}),
        transaction: {
          chainId: 10143,
          sender: state.masterAddress!,
          destination: "0x1111111111111111111111111111111111111111",
          maximumGasCost: "1000000000000000",
        },
      });
      return;
    }
    const keyScope = scope + ":request";
    const existing = memory.outcome<{ key: string; signature: string } | null>(keyScope, null);
    const signature = JSON.stringify({ kind, asset, trade, version: state.draft?.version ?? 0 });
    const key = existing?.signature === signature ? existing.key : crypto.randomUUID();
    memory.setOutcome(keyScope, { key, signature });
    const result = tokenOperationPreparedSchema.parse(
      await studioApi(url, {
        method: "POST",
        signal: AbortSignal.timeout(90_000),
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          action: kind,
          ...(trade ? { trade } : { asset }),
          expectedVersion: state.draft?.version ?? 0,
        }),
      }),
    );
    retain(result.operation);
    if (owned()) {
      setActivity(result.activity);
    }
  }
  async function sign() {
    if (!current) {
      return;
    }
    if (preview) {
      retain({ ...current, version: current.version + 1, status: "confirming" });
      return;
    }
    let signed;
    if (current.status === "awaiting_signature") {
      const unsigned = current.activity ?? activity;
      if (!unsigned) {
        await check();
        return;
      }
      const { stampActivity, relyingParty } = await import("../studio/lib/passkey");
      try {
        signed = await stampActivity(await relyingParty(), unsigned);
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          if (owned()) {
            setError("Signature cancelled. The draft is kept.");
          }
          return;
        }
        throw e;
      }
    }
    if (!owned()) {
      return;
    }
    setBusy("submit");
    retain(
      tokenOperationSchema.parse(
        await studioApi(`${url}/${current.id}/confirm`, {
          method: "POST",
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({ expectedVersion: current.version, ...(signed ? { signed } : {}) }),
        }),
      ),
    );
  }
  async function check() {
    if (!current) {
      return;
    }
    if (preview) {
      retain({ ...current, version: current.version + 1, status: "finalized" });
      if (current.action === "launch") {
        const { PREVIEW_TOKEN } = await import("./fixture");
        onChange({
          ...state,
          token: {
            ...PREVIEW_TOKEN,
            name: state.draft?.name ?? PREVIEW_TOKEN.name,
            ticker: state.draft?.ticker ?? PREVIEW_TOKEN.ticker,
          },
          confirmation: "confirmed",
          blockers: ["TOKEN_ALREADY_LAUNCHED"],
          venue: {
            status: "curve",
            market: null,
            vault: null,
            accountId: null,
            positions: [],
            liquidityLocked: false,
          },
        });
      }
      if (current.action === "graduate") {
        onChange({
          ...state,
          venue: {
            status: "uniswap_v4",
            readyToGraduate: false,
            market: "0x3333333333333333333333333333333333333333",
            vault: "0x4444444444444444444444444444444444444444",
            accountId: null,
            poolId: "0x" + "a".repeat(64),
            lpFeeBps: 100,
            positions: ["1"],
            liquidityLocked: true,
          },
        });
      }
      return;
    }
    const updated = tokenOperationSchema.parse(
      await studioApi(`${url}/${current.id}`, { signal: AbortSignal.timeout(90_000) }),
    );
    retain(updated);
    if (owned() && updated.status === "finalized") {
      memory.setOutcome(scope + ":request", null);
      const { tokenStateSchema } = await import("@pickler/api-schema");
      const state = tokenStateSchema.parse(
        await studioApi(`/agents/${agentId}/token`, { signal: AbortSignal.timeout(15_000) }),
      );
      if (owned()) {
        onChange(state);
      }
    }
  }
  async function cancel() {
    if (!current) {
      return;
    }
    if (preview) {
      retain({ ...current, version: current.version + 1, status: "cancelled" });
      return;
    }
    retain(
      tokenOperationSchema.parse(
        await studioApi(`${url}/${current.id}/cancel`, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ expectedVersion: current.version }),
        }),
      ),
    );
    if (owned()) {
      memory.setOutcome(scope + ":request", null);
    }
  }
  const graduated = state.venue?.status === "kuru" || state.venue?.status === "uniswap_v4";
  const targetVenue = state.launchVenue
    ? { kuru_passive: "Kuru", uniswap_v4: "Uniswap" }[state.launchVenue.name]
    : "DEX";
  const usable = enabled && (preview || state.available);
  return (
    <section className={styles.card} aria-label="Token operations" aria-busy={busy !== null}>
      <div className={styles.head}>
        <h3>{state.token ? "Launch & liquidity" : "Launch"}</h3>
        {preview && <Tag>PREVIEW</Tag>}
      </div>
      {busy && (
        <div className={styles.progress} role="status" aria-label={progress[busy]}>
          <Icon name="refresh" size={18} className={styles.spinner} />
          <div>
            <strong>{progress[busy]}</strong>
            {busy === "launch" && (
              <p className={styles.quiet}>Checking the launch before your passkey request.</p>
            )}
          </div>
        </div>
      )}
      {current && busy !== "launch" && busy !== "prepare" && (
        <div role="status">
          <strong>
            {current.status === "failed" && !current.activityId && !current.txHash
              ? "Preparation failed"
              : labels[current.status]}
          </strong>
          {current.status === "finalized" && current.quote && (
            <p className={styles.quiet}>
              {current.quote.approval
                ? "Amount approved. Review the trade to continue."
                : current.quote.side === "buy"
                  ? "Purchase confirmed."
                  : "Sale confirmed."}
            </p>
          )}
          {current.txHash && (
            <p className={styles.quiet}>
              Transaction {current.txHash.slice(0, 10)}…{current.txHash.slice(-6)}
            </p>
          )}
        </div>
      )}
      {current?.quote && active && (
        <dl className={styles.details} aria-label="Trade review">
          <div className={styles.detail}>
            <dt>Action</dt>
            <dd>
              {current.quote.approval
                ? "Exact amount approval · no trade"
                : current.quote.side === "buy"
                  ? "Buy token"
                  : "Sell token"}
            </dd>
          </div>
          <div className={styles.detail}>
            <dt>{current.quote.approval ? "Allowance" : "You pay"}</dt>
            <dd>
              {units(current.quote.amount, current.quote.side === "buy" ? 6 : 18)}{" "}
              {current.quote.side === "buy" ? "AUSD" : state.token?.ticker}
            </dd>
          </div>
          {!current.quote.approval && (
            <>
              <div className={styles.detail}>
                <dt>Expected output · after fee</dt>
                <dd>
                  {units(current.quote.expectedOutput, current.quote.side === "buy" ? 18 : 6)}{" "}
                  {current.quote.side === "buy" ? state.token?.ticker : "AUSD"}
                </dd>
              </div>
              <div className={styles.detail}>
                <dt>Minimum you receive</dt>
                <dd>
                  {units(current.quote.minimumOutput, current.quote.side === "buy" ? 18 : 6)}{" "}
                  {current.quote.side === "buy" ? state.token?.ticker : "AUSD"}
                </dd>
              </div>
              <div className={styles.detail}>
                <dt>Slippage / curve fee</dt>
                <dd>
                  {current.quote.slippageBps / 100}% / {current.quote.feeBps / 100}%
                </dd>
              </div>
            </>
          )}
        </dl>
      )}
      {current?.transaction && active && (
        <dl className={styles.details}>
          <div className={styles.detail}>
            <dt>Network</dt>
            <dd>Monad testnet</dd>
          </div>
          <div className={styles.detail}>
            <dt>Sender · master wallet</dt>
            <dd>
              <abbr title={current.transaction.sender}>
                {current.transaction.sender.slice(0, 8)}…{current.transaction.sender.slice(-6)}
              </abbr>
            </dd>
          </div>
          <div className={styles.detail}>
            <dt>Maximum gas cost</dt>
            <dd>{units(current.transaction.maximumGasCost, 18)} MON</dd>
          </div>
        </dl>
      )}
      {state.token && (
        <TokenTradeForm
          agentId={agentId}
          state={state}
          preview={preview}
          disabled={!usable || !!busy || !!active || !!state.venue?.readyToGraduate}
          prepare={(kind, trade) => void action("prepare", () => prepare(kind, "ausd", trade))}
        />
      )}
      {!busy && (error || current?.status === "failed") && (
        <p className={styles.feedback} role="alert">
          {error ??
            tokenOperationErrorMessage(
              current?.error ?? null,
              !!(current?.activityId || current?.txHash),
            )}
        </p>
      )}
      {state.token && (
        <dl className={styles.details}>
          <div className={styles.detail}>
            <dt>Token</dt>
            <dd>Launched · Monad {state.token.chainId === 10143 ? "testnet" : "mainnet"}</dd>
          </div>
          <div className={styles.detail}>
            <dt>Graduation</dt>
            <dd>
              {graduated
                ? `${state.venue?.status === "kuru" ? "Kuru" : "Uniswap V4"} · liquidity permanently locked`
                : state.venue?.status === "curve"
                  ? "On the curve"
                  : "Graduation not attributed"}
            </dd>
          </div>
          {state.venue?.market && (
            <div className={styles.detail}>
              <dt>{state.venue?.status === "uniswap_v4" ? "Pool manager" : "Kuru market"}</dt>
              <dd>
                <abbr title={state.venue.market}>
                  {state.venue.market.slice(0, 8)}…{state.venue.market.slice(-6)}
                </abbr>
              </dd>
            </div>
          )}
          {state.venue?.vault && (
            <div className={styles.detail}>
              <dt>Liquidity locker</dt>
              <dd>
                <abbr title={state.venue.vault}>
                  {state.venue.vault.slice(0, 8)}…{state.venue.vault.slice(-6)}
                </abbr>
              </dd>
            </div>
          )}
          {state.venue?.poolId && (
            <div className={styles.detail}>
              <dt>Pool ID</dt>
              <dd>
                <abbr title={state.venue.poolId}>
                  {state.venue.poolId.slice(0, 10)}…{state.venue.poolId.slice(-6)}
                </abbr>
              </dd>
            </div>
          )}
          {state.venue?.status === "uniswap_v4" && (
            <div className={styles.detail}>
              <dt>Position NFT</dt>
              <dd>#{state.venue.positions.join(", #")}</dd>
            </div>
          )}
          {state.venue?.lpFeeBps != null && (
            <div className={styles.detail}>
              <dt>Uniswap swap fee</dt>
              <dd>{state.venue.lpFeeBps / 100}% · no additional Pickler swap fee</dd>
            </div>
          )}
          {graduated && (
            <div className={styles.detail}>
              <dt>LP fees</dt>
              <dd>Actual receipts · 50% creator / 50% Pickler</dd>
            </div>
          )}
          {state.fees && (
            <div className={styles.detail}>
              <dt>Master wallet fees · as indexed at block {state.fees.block}</dt>
              <dd>
                {units(state.fees.ausd, 6)} AUSD · {units(state.fees.agent, 18)}{" "}
                {state.token.ticker}
              </dd>
            </div>
          )}
        </dl>
      )}
      <div className={styles.actions}>
        {!state.token && !active && (
          <Button
            disabled={!usable || !draftSaved || !!busy || state.confirmation === "pending"}
            onClick={() => void action("launch", () => prepare("launch"))}
          >
            {busy === "launch" ? "Preparing…" : "Launch token"}
          </Button>
        )}
        {current?.status === "awaiting_signature" && (
          <Button disabled={!!busy} onClick={() => void action("sign", sign)}>
            {preview ? "Continue preview" : "Sign with passkey"}
          </Button>
        )}
        {current?.status === "signed" && (
          <Button disabled={!!busy} onClick={() => void action("submit", sign)}>
            Submit signed transaction
          </Button>
        )}
        {active && (
          <Button variant="secondary" disabled={!!busy} onClick={() => void action("check", check)}>
            Check status
          </Button>
        )}
        {current && ["awaiting_signature", "preparing"].includes(current.status) && (
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => void action("cancel", cancel)}
          >
            Cancel
          </Button>
        )}
        {preview && active && (
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() =>
              retain({
                ...current,
                version: current.version + 1,
                status: "failed",
                error: "CONTROLLED_FAILURE",
              })
            }
          >
            Preview failure
          </Button>
        )}
        {state.token && !active && (
          <>
            {state.venue?.status === "curve" && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!usable || !!busy || !state.venue?.readyToGraduate}
                onClick={() => void action("prepare", () => prepare("graduate"))}
              >
                Graduate to {targetVenue}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || !!busy}
              onClick={() => void action("prepare", () => prepare("collect_curve_fees"))}
            >
              Collect curve fees
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || !!busy || !graduated}
              onClick={() => void action("prepare", () => prepare("collect_lp_fees"))}
            >
              Collect LP fees
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || !!busy}
              onClick={() => void action("prepare", () => prepare("claim_fees"))}
            >
              Claim master AUSD fees
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || !!busy}
              onClick={() => void action("prepare", () => prepare("claim_fees", "agent"))}
            >
              Claim token fees
            </Button>
          </>
        )}
      </div>
      {!state.token && !draftSaved && (
        <p className={styles.quiet}>Save your draft before launching.</p>
      )}
      {!usable && (
        <p className={styles.quiet}>
          Testnet operations are unavailable until the deployment and launch policy are verified.
        </p>
      )}
      {state.token && (
        <p className={styles.exampleNote}>
          AUSD claims include this master wallet’s fees across its agents. Principal cannot be
          withdrawn. Gas is paid in MON.
        </p>
      )}
      {error && !active && !preview && (
        <Button
          variant="secondary"
          disabled={!!busy}
          onClick={() => void action("refresh", refresh)}
        >
          Refresh status
        </Button>
      )}
    </section>
  );
}

"use client";
import { useState } from "react";
import { Button, Skeleton, Tag } from "@pickler/ui";
import {
  tokenOperationSchema,
  tokenOperationPreparedSchema,
  type TokenStateDto,
  type TokenOperationDto,
} from "@pickler/api-schema";
import { studioApi } from "../studio/api";
import { useStudioMemory } from "../studio/routing/memory";
import styles from "./token.module.css";
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
  const [operation, setOperation] = useState(() => {
    const remembered = memory.outcome<TokenOperationDto | null>(scope, null);
    const server = state.operation;
    return { server, value: server ? newest(remembered, server) : remembered };
  });
  const [activity, setActivity] = useState<
    ReturnType<typeof tokenOperationPreparedSchema.parse>["activity"]
  >(() => null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const current =
    state.operation && state.operation !== operation.server
      ? newest(operation.value, state.operation)
      : (operation.value ?? state.operation);
  function retain(value: TokenOperationDto) {
    setOperation({ value, server: state.operation });
    memory.setOutcome(scope, value);
    if (["failed", "cancelled", "finalized"].includes(value.status)) {
      memory.setOutcome(scope + ":request", null);
    }
  }
  const active = current && !["failed", "cancelled", "finalized"].includes(current.status);
  const url = `/agents/${agentId}/token/operations`;
  async function action(work: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    memory.begin(scope);
    try {
      await work();
    } catch {
      if (!preview) {
        // This is a database-only read after an explicit action, not provider polling.
        try {
          const { tokenStateSchema } = await import("@pickler/api-schema");
          const latest = tokenStateSchema.parse(await studioApi(`/agents/${agentId}/token`));
          if (latest.operation) {
            retain(latest.operation);
          }
          onChange(latest);
        } catch {
          /* Keep uncertain request identity when even stored state is unavailable. */
        }
      }
      setError(
        "The request could not be confirmed. Your draft is kept. Check its status before trying again.",
      );
    } finally {
      memory.end(scope);
      setBusy(false);
    }
  }
  async function prepare(kind: TokenOperationDto["action"], asset: "ausd" | "agent" = "ausd") {
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
    const existing = memory.outcome<{ key: string; kind: string; asset: string } | null>(
      keyScope,
      null,
    );
    const key =
      existing?.kind === kind && existing.asset === asset ? existing.key : crypto.randomUUID();
    memory.setOutcome(keyScope, { key, kind, asset });
    const result = tokenOperationPreparedSchema.parse(
      await studioApi(url, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ action: kind, asset, expectedVersion: state.draft?.version ?? 0 }),
      }),
    );
    retain(result.operation);
    setActivity(result.activity);
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
          setError("Signature cancelled. The draft is kept.");
          return;
        }
        throw e;
      }
    }
    retain(
      tokenOperationSchema.parse(
        await studioApi(`${url}/${current.id}/confirm`, {
          method: "POST",
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
    const updated = tokenOperationSchema.parse(await studioApi(`${url}/${current.id}`));
    retain(updated);
    if (updated.status === "finalized") {
      memory.setOutcome(scope + ":request", null);
      const { tokenStateSchema } = await import("@pickler/api-schema");
      onChange(tokenStateSchema.parse(await studioApi(`/agents/${agentId}/token`)));
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
          body: JSON.stringify({ expectedVersion: current.version }),
        }),
      ),
    );
    memory.setOutcome(scope + ":request", null);
  }
  const graduated = state.venue?.status === "kuru" || state.venue?.status === "uniswap_v4";
  const targetVenue = state.launchVenue
    ? { kuru_passive: "Kuru", uniswap_v4: "Uniswap" }[state.launchVenue.name]
    : "DEX";
  const usable = enabled && (preview || state.available);
  return (
    <section className={styles.card} aria-label="Token operations" aria-busy={busy}>
      <div className={styles.head}>
        <h3>{state.token ? "Launch & liquidity" : "Launch"}</h3>
        {preview && <Tag>PREVIEW</Tag>}
      </div>
      {busy && <Skeleton shape="line" />}
      {current && (
        <div role="status">
          <strong>{labels[current.status]}</strong>
          {current.txHash && (
            <p className={styles.quiet}>
              Transaction {current.txHash.slice(0, 10)}…{current.txHash.slice(-6)}
            </p>
          )}
        </div>
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
            disabled={!usable || !draftSaved || busy || state.confirmation === "pending"}
            onClick={() => void action(() => prepare("launch"))}
          >
            Launch token
          </Button>
        )}
        {current?.status === "awaiting_signature" && (
          <Button disabled={busy} onClick={() => void action(sign)}>
            {preview ? "Continue preview" : "Sign with passkey"}
          </Button>
        )}
        {current?.status === "signed" && (
          <Button disabled={busy} onClick={() => void action(sign)}>
            Submit signed transaction
          </Button>
        )}
        {active && (
          <Button variant="secondary" disabled={busy} onClick={() => void action(check)}>
            Check status
          </Button>
        )}
        {current && ["awaiting_signature", "preparing"].includes(current.status) && (
          <Button variant="secondary" disabled={busy} onClick={() => void action(cancel)}>
            Cancel
          </Button>
        )}
        {preview && active && (
          <Button
            variant="secondary"
            disabled={busy}
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
                disabled={!usable || busy || !state.venue?.readyToGraduate}
                onClick={() => void action(() => prepare("graduate"))}
              >
                Graduate to {targetVenue}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || busy}
              onClick={() => void action(() => prepare("collect_curve_fees"))}
            >
              Collect curve fees
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || busy || !graduated}
              onClick={() => void action(() => prepare("collect_lp_fees"))}
            >
              Collect LP fees
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || busy}
              onClick={() => void action(() => prepare("claim_fees"))}
            >
              Claim master AUSD fees
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!usable || busy}
              onClick={() => void action(() => prepare("claim_fees", "agent"))}
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
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

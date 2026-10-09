"use client";
import { useEffect, useState } from "react";
import { Button, Field, Icon, Input, Skeleton, Tag } from "@pickler/ui";
import { tokenStateSchema, tokenDraftSchema, type TokenStateDto } from "@pickler/api-schema";
import { studioApi, type Agent } from "../studio/api";
import { AgentAvatar } from "../studio/shell/agent-avatar";
import { useStudioForm, useStudioMemory } from "../studio/routing/memory";
import { AgentTokenCard } from "./agent-token-card";
import { PREVIEW_TOKEN } from "./fixture";
import styles from "./token.module.css";

type Phase = "editing" | "review" | "awaiting" | "confirming" | "error" | "launched";
const wholeTokens = (units: string) => {
  const value = BigInt(units);
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return (value / 10n ** 18n).toLocaleString("en-US") + (fraction ? `.${fraction}` : "");
};

/** Only the local fixture advances a launch. Hosted composition has no grant issuer or sender. */
export function TokenPanel({
  agent,
  initialState,
  preview,
  canManage,
  onGoPublic,
}: {
  agent: Agent;
  initialState: TokenStateDto | null;
  preview: boolean;
  canManage: boolean;
  onGoPublic?: () => void;
}) {
  const memory = useStudioMemory();
  const scope = `${agent.productId ?? agent.id}:token`;
  const [state, setState] = useState<TokenStateDto | null>(() =>
    preview ? memory.outcome(scope + ":saved", initialState) : initialState,
  );
  const [phase, changePhase] = useState<Phase>(() =>
    preview ? memory.outcome(scope + ":phase", "editing") : "editing",
  );
  function setPhase(next: Phase) {
    changePhase(next);
    if (preview) {
      memory.setOutcome(scope + ":phase", next);
    }
  }
  const [readError, setReadError] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(!initialState);
  const [saving, setSaving] = useState(false);
  const [form, edit] = useStudioForm(scope + ":fields", state?.draft?.version ?? 0, {
    name: state?.draft?.name ?? agent.name ?? "Agent",
    ticker:
      state?.draft?.ticker ??
      (agent.handle ?? "TOKEN")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 6)
        .toUpperCase(),
  });
  useEffect(() => {
    if (preview) {
      return;
    }
    const controller = new AbortController();
    void studioApi<unknown>(`/agents/${agent.productId ?? agent.id}/token`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState(tokenStateSchema.parse(data));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [agent.id, agent.productId, preview, attempt]);

  function retryRead() {
    setLoading(true);
    setReadError(false);
    setWriteError(null);
    setAttempt((n) => n + 1);
  }
  const stale = memory.stale(scope, state?.draft?.version ?? 0);
  const saveBlocked =
    state?.chainId === null ||
    (state?.blockers.some((b) => b !== "GO_PUBLIC_FIRST" && b !== "LAUNCH_UNAVAILABLE") ?? false);
  let availabilityMessage = "Token launch is not available yet. You can save your draft.";
  if (state?.confirmation === "pending") {
    availabilityMessage = "Waiting for token confirmation.";
  } else if (state?.blockers.includes("CREATOR_ACCESS_REQUIRED")) {
    availabilityMessage = "Creator access is required to save a token draft.";
  } else if (state?.blockers.includes("MASTER_WALLET_REQUIRED")) {
    availabilityMessage = "Register your master wallet before saving this draft.";
  } else if (saveBlocked || !canManage) {
    availabilityMessage = "Token draft editing is currently unavailable.";
  }
  const avatar = <AgentAvatar accent={agent.accent} pattern={agent.avatarPattern} size="head" />;
  const launched =
    phase === "launched"
      ? { ...PREVIEW_TOKEN, name: form.name, ticker: form.ticker }
      : state?.token;
  async function save() {
    if (!canManage || saving || loading || readError || stale || saveBlocked) {
      return;
    }
    setSaving(true);
    setWriteError(null);
    memory.begin(scope);
    try {
      if (preview && state) {
        const saved = {
          ...state,
          draft: {
            id: state.draft?.id ?? "10000000-0000-4000-8000-000000000002",
            version: (state.draft?.version ?? 0) + 1,
            name: form.name,
            ticker: form.ticker,
            status: "draft" as const,
          },
        };
        setState(saved);
        memory.setOutcome(scope + ":saved", saved);
        memory.committed(scope);
        return;
      }
      const draft = tokenDraftSchema.parse(
        await studioApi(`/agents/${agent.productId ?? agent.id}/token/draft`, {
          method: "PUT",
          body: JSON.stringify({ ...form, expectedVersion: state?.draft?.version ?? 0 }),
        }),
      );
      setState((previous) => (previous ? { ...previous, draft } : previous));
      memory.committed(scope);
    } catch {
      setWriteError("Could not save. Your edits are kept; reload the state before trying again.");
    } finally {
      memory.end(scope);
      setSaving(false);
    }
  }
  const privateAgent = agent.draft || state?.blockers.includes("GO_PUBLIC_FIRST");
  const valid =
    !!form.name.trim() && form.name.trim().length <= 40 && /^[A-Z][A-Z0-9]{1,5}$/.test(form.ticker);
  const reviewing = phase !== "editing" && phase !== "launched";
  return (
    <div className={styles.panel}>
      {preview && (
        <p className={styles.quiet}>Preview · simulated launch, no signatures or transactions</p>
      )}
      {launched ? (
        <AgentTokenCard token={launched} avatar={avatar} preview={preview} />
      ) : (
        <>
          <section className={styles.card} aria-label="Token launch">
            <div className={styles.head}>
              {avatar}
              <div className={styles.identity}>
                <h3>Token</h3>
                <p className={styles.quiet}>Launch a token for {agent.name}.</p>
              </div>
              {state?.chainId && <Tag>{state.chainId === 10143 ? "TESTNET" : "MAINNET"}</Tag>}
            </div>
            {loading && (
              <div aria-label="Loading token" role="status">
                <Skeleton shape="title" />
                <Skeleton shape="line" />
              </div>
            )}
            {readError && (
              <div role="alert">
                <p>Token status could not be read.</p>
                <Button size="sm" variant="secondary" onClick={retryRead}>
                  Retry
                </Button>
              </div>
            )}
            <div className={styles.fields}>
              <Field label="Token name">
                <Input
                  value={form.name}
                  maxLength={40}
                  disabled={!canManage || reviewing}
                  onChange={(event) => edit({ ...form, name: event.target.value })}
                />
              </Field>
              <Field label="Ticker">
                <Input
                  value={form.ticker}
                  maxLength={6}
                  disabled={!canManage || reviewing}
                  onChange={(event) =>
                    edit({ ...form, ticker: event.target.value.toUpperCase().replace(/^\$/, "") })
                  }
                />
              </Field>
            </div>
            {writeError && (
              <div role="alert">
                <p>{writeError}</p>
                <Button size="sm" variant="secondary" onClick={retryRead}>
                  Reload state
                </Button>
              </div>
            )}
            {stale && (
              <div role="alert">
                <p>A newer draft was saved. Your edits are kept.</p>
                <Button size="sm" variant="secondary" onClick={() => memory.discard(scope)}>
                  Use saved draft
                </Button>
              </div>
            )}
            <div className={styles.actions}>
              {privateAgent ? (
                <Button size="sm" onClick={onGoPublic} disabled={!onGoPublic}>
                  Go public first
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={
                    !preview ||
                    stale ||
                    !state?.available ||
                    !canManage ||
                    !valid ||
                    loading ||
                    readError ||
                    reviewing
                  }
                  onClick={() => setPhase("review")}
                >
                  Review launch
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  !canManage ||
                  loading ||
                  readError ||
                  saving ||
                  reviewing ||
                  !valid ||
                  stale ||
                  saveBlocked
                }
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save draft"}
              </Button>
            </div>
            {state?.confirmation === "pending" && <p role="status">Token confirmation pending</p>}
            {!preview && !loading && !readError && (
              <p className={styles.quiet}>{availabilityMessage}</p>
            )}
          </section>
          {reviewing && state?.preset && (
            <section className={styles.card} aria-label="Review token launch">
              <div className={styles.head}>
                <Icon name="coin" />
                <h3>Review launch</h3>
                <Tag>SIMULATED</Tag>
              </div>
              <dl className={styles.details}>
                {[
                  ["Network", state.chainId === 10143 ? "Monad testnet" : "Monad mainnet"],
                  ["Token", `${form.name} · $${form.ticker}`],
                  ["Supply", wholeTokens(state.preset.totalSupply)],
                  ["Curve allocation", wholeTokens(state.preset.saleAllocation)],
                  ["Liquidity allocation", wholeTokens(state.preset.lpAllocation)],
                  [
                    "Buy / sell fee",
                    `${state.preset.buyFeeBps / 100}% / ${state.preset.sellFeeBps / 100}%`,
                  ],
                  ["Protocol share of fees", `${state.preset.protocolShareBps / 100}%`],
                  ["Creator share of LP fees", `${state.preset.lpCreatorShareBps / 100}%`],
                  ["Launch cost", `${wholeTokens(state.preset.launchFee)} MON`],
                ].map(([label, value]) => (
                  <div className={styles.detail} key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.quiet}>Demo preset · these values are not a launch quote.</p>
              <div className={styles.status} aria-live="polite">
                {phase === "awaiting" && <p>Awaiting signature · simulated</p>}
                {phase === "confirming" && <p>Confirming · simulated</p>}
                {phase === "error" && (
                  <p role="alert">Simulated launch failed. Your draft is kept.</p>
                )}
                <div className={styles.actions}>
                  {(phase === "review" || phase === "error") && (
                    <Button size="sm" onClick={() => setPhase("awaiting")}>
                      {phase === "error" ? "Try again" : "Simulate launch"}
                    </Button>
                  )}
                  {phase === "awaiting" && (
                    <Button size="sm" onClick={() => setPhase("confirming")}>
                      Simulate signature
                    </Button>
                  )}
                  {phase === "confirming" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        memory.committed(scope);
                        setPhase("launched");
                      }}
                    >
                      Simulate confirmation
                    </Button>
                  )}
                  {(phase === "awaiting" || phase === "confirming") && (
                    <Button size="sm" variant="secondary" onClick={() => setPhase("error")}>
                      Simulate failure
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setPhase("editing")}>
                    Cancel
                  </Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

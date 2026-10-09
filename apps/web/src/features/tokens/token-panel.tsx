"use client";
import { useEffect, useState } from "react";
import { Button, Field, Icon, Input, Meter, Skeleton, Tag } from "@pickler/ui";
import {
  AGENT_TOKEN_TOTAL_SUPPLY,
  tokenStateSchema,
  tokenDraftSchema,
  type TokenStateDto,
} from "@pickler/api-schema";
import { studioApi, type Agent } from "../studio/api";
import { AgentAvatar } from "../studio/shell/agent-avatar";
import { useStudioForm, useStudioMemory } from "../studio/routing/memory";
import { AgentTokenCard } from "./agent-token-card";
import styles from "./token.module.css";

const wholeTokens = (units: string) => {
  const value = BigInt(units);
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return (value / 10n ** 18n).toLocaleString("en-US") + (fraction ? `.${fraction}` : "");
};

/** Formatting only. All economic calculations come from the versioned server summary. */
const amount = (units: string, decimals: number, places: number) => {
  const scale = 10n ** BigInt(decimals);
  const rounding = 10n ** BigInt(decimals - places);
  const rounded = ((BigInt(units) + rounding / 2n) / rounding) * rounding;
  const fraction = (rounded % scale).toString().padStart(decimals, "0").slice(0, places);
  return (rounded / scale).toLocaleString("en-US") + (places ? "." + fraction : "");
};

/** Draft details update locally. No signer or transaction sender is composed here. */
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
  const [readError, setReadError] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(!initialState);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
  const launched = state?.token;
  async function save() {
    if (!canManage || saving || loading || readError || stale || saveBlocked) {
      return;
    }
    setSaving(true);
    setSaved(false);
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
        setSaved(true);
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
      setSaved(true);
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
  const economics = state?.economics;
  const allocation = (units: string, percent: number) => `${wholeTokens(units)} · ${percent}%`;
  return (
    <div className={styles.panel}>
      {launched ? (
        <AgentTokenCard token={launched} avatar={avatar} preview={preview} />
      ) : (
        <>
          <section className={styles.card} aria-label="Token launch">
            <div className={styles.head}>
              <div className={styles.identity}>
                <h3>Launch token</h3>
                <p className={styles.quiet}>For {agent.name}</p>
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
                  disabled={!canManage || saving}
                  onChange={(event) => {
                    setSaved(false);
                    edit({ ...form, name: event.target.value });
                  }}
                />
              </Field>
              <Field label="Ticker">
                <Input
                  value={form.ticker}
                  maxLength={6}
                  disabled={!canManage || saving}
                  onChange={(event) => {
                    setSaved(false);
                    edit({ ...form, ticker: event.target.value.toUpperCase().replace(/^\$/, "") });
                  }}
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
            <section className={styles.summary} aria-label="Token launch details">
              <div className={styles.supplyHero}>
                <div className={styles.supply}>
                  <span className={styles.quiet}>Total supply</span>
                  <strong>{wholeTokens(AGENT_TOKEN_TOTAL_SUPPLY)}</strong>
                </div>
                <div className={styles.tokenPreview}>
                  <div className={styles.previewIdentity}>
                    <AgentAvatar accent={agent.accent} pattern={agent.avatarPattern} size="chip" />
                    <strong>
                      {form.name || "—"} · ${form.ticker || "—"}
                    </strong>
                  </div>
                  <span className={styles.quiet}>Fixed forever · no further minting</span>
                </div>
              </div>
              {loading ? (
                <div role="status" aria-label="Loading launch details">
                  <Skeleton shape="line" />
                  <Skeleton shape="line" />
                </div>
              ) : readError ? (
                <p className={styles.quiet}>
                  Wallet and launch terms are unavailable. Retry above.
                </p>
              ) : (
                <>
                  <div className={styles.distribution}>
                    <div className={styles.head}>
                      <h4>Distribution</h4>
                      <Tag>REFERENCE</Tag>
                    </div>
                    {economics ? (
                      <>
                        <Meter
                          value={economics.salePercent}
                          tone="lime"
                          className={styles.distributionTrack}
                        />
                        <dl className={styles.allocations}>
                          <div>
                            <dt>
                              <span className={styles.curveDot} />
                              Bonding curve
                            </dt>
                            <dd>{allocation(economics.saleAllocation, economics.salePercent)}</dd>
                          </div>
                          <div>
                            <dt>
                              <span className={styles.liquidityDot} />
                              Liquidity
                            </dt>
                            <dd>{allocation(economics.lpAllocation, economics.lpPercent)}</dd>
                          </div>
                        </dl>
                        <dl className={styles.details}>
                          <div className={styles.detail}>
                            <dt>Creator / project reserve</dt>
                            <dd>0 tokens</dd>
                          </div>
                        </dl>
                      </>
                    ) : (
                      <p className={styles.quiet}>Launch terms are unavailable.</p>
                    )}
                  </div>
                  {economics && (
                    <section className={styles.economics} aria-label="Launch economics">
                      <h4>Launch economics</h4>
                      <dl className={styles.economicFigures}>
                        <div>
                          <dt>Initial valuation · FDV</dt>
                          <dd>
                            ≈{amount(economics.initialFdvWad, 18, 0)} <span>AUSD</span>
                          </dd>
                        </div>
                        <div>
                          <dt>At curve completion · FDV</dt>
                          <dd>
                            ≈{amount(economics.finalFdvWad, 18, 0)} <span>AUSD</span>
                          </dd>
                        </div>
                        <div>
                          <dt>Net reserve at completion</dt>
                          <dd>
                            ≈{amount(economics.netReserveAtCompletion, 6, 0)} <span>AUSD</span>
                          </dd>
                        </div>
                      </dl>
                      <dl className={styles.priceDetails}>
                        <div className={styles.detail}>
                          <dt>Initial / final token price</dt>
                          <dd>
                            ≈{amount(economics.initialPriceWad, 18, 8)} /{" "}
                            {amount(economics.finalPriceWad, 18, 8)} AUSD
                          </dd>
                        </div>
                      </dl>
                    </section>
                  )}
                  <dl className={styles.walletDetails}>
                    <div>
                      <dt>
                        <Icon name="wallet" size={16} />
                        Creator wallet
                      </dt>
                      <dd>
                        {state?.masterAddress ? (
                          <abbr title={state.masterAddress}>
                            {state.masterAddress.slice(0, 8)}…{state.masterAddress.slice(-6)}
                          </abbr>
                        ) : state?.masterAddress === null ? (
                          "Not registered"
                        ) : (
                          "Unavailable"
                        )}
                      </dd>
                      <dd className={styles.quiet}>Creator & fee recipient</dd>
                    </div>
                    <div>
                      <dt>
                        <Icon name="shield" size={16} />
                        Token admin
                      </dt>
                      <dd>None</dd>
                      <dd className={styles.quiet}>No owner privileges</dd>
                    </div>
                  </dl>
                  {economics && (
                    <div className={styles.preset}>
                      <h4>Fees</h4>
                      <dl className={styles.fees}>
                        {[
                          [
                            "Buy / sell",
                            `${economics.buyFeeBps / 100}% / ${economics.sellFeeBps / 100}%`,
                          ],
                          ["Launch fee", `${amount(economics.launchFee, 6, 0)} AUSD`],
                          [
                            "Trade fees · creator / Pickler",
                            `${(10000 - economics.protocolShareBps) / 100}% / ${economics.protocolShareBps / 100}%`,
                          ],
                          ["Network gas", "Paid separately in MON"],
                        ].map(([label, value]) => (
                          <div className={styles.detail} key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  {economics && (
                    <p className={styles.exampleNote}>
                      After migration: Pending DEX configuration.
                    </p>
                  )}
                  <p className={styles.exampleNote}>
                    {preview ? "Local preview" : "Reference terms"} · Launch disabled.
                  </p>
                </>
              )}
            </section>
            <div className={styles.launchActions}>
              {privateAgent ? (
                <Button onClick={onGoPublic} disabled={!onGoPublic}>
                  Go public first
                </Button>
              ) : (
                <Button disabled>Launch token</Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  !canManage || loading || readError || saving || !valid || stale || saveBlocked
                }
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save draft"}
              </Button>
            </div>
            {saved && (
              <p className={styles.quiet} role="status">
                Draft saved
              </p>
            )}
            {state?.confirmation === "pending" && <p role="status">Token confirmation pending</p>}
            {!loading && !readError && <p className={styles.quiet}>{availabilityMessage}</p>}
          </section>
        </>
      )}
    </div>
  );
}

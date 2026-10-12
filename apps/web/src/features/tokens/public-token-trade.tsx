"use client";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import {
  publicTokenTradePreparedSchema,
  publicTokenTradeConfirmationSchema,
  type AgentTokenDto,
  type PublicTokenTradePreparedDto,
} from "@pickler/api-schema";
import { AUSD, toBaseUnits } from "@pickler/chain";
import { formatUnits } from "viem";
import { Button, Field, Input, Segmented, Tag } from "@pickler/ui";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import {
  publicTokenReceipt,
  WalletSubmissionUnknown,
} from "@/features/wallet/lib/public-token-transaction";
import {
  readPublicTrade,
  writePublicTrade,
  subscribePublicTrade,
  type PublicTradeAttempt,
} from "@/features/wallet/lib/public-trade-memory";
import {
  runPublicTokenTrade,
  waitForPublicTradeReceipt,
} from "@/features/wallet/lib/public-trade-flow";
import { ChainReference } from "./chain-reference";
import { PublicTradeAction, type TradeActionState } from "./public-trade-action";
import { usePublicTradeQuote } from "./use-public-trade-quote";
import quotes from "./trade-quotes.json";
import styles from "./public-token-trade.module.css";
const WORDS: Record<string, string> = {
  TRADING_UNAVAILABLE: "Public trading is not enabled on this deployment yet.",
  TOKEN_NOT_FOUND: "This token is not confirmed for trading.",
  RPC_LIMIT: "Too many requests. Try again later.",
  CURVE_CLOSED: "The curve is complete. DEX trading is not connected yet.",
  INSUFFICIENT_TOKEN_BALANCE: "Your wallet does not have enough of the selected asset.",
  INSUFFICIENT_GAS: "Your wallet needs MON for gas.",
  TRADE_TOO_SMALL: "This amount is too small.",
  EXCEEDS_CURVE_INVENTORY: "This purchase exceeds the remaining curve supply.",
  DEPLOYMENT_CHANGED: "Contract verification failed. Trading is unavailable.",
  PROVIDER_UNAVAILABLE: "Could not read the network. No swap was sent.",
};
function quotedAmount(value: string, decimals: number, asset: string) {
  const exact = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = exact.split(".");
  const short = fraction.slice(0, 6).replace(/0+$/, "");
  const approximate = /[1-9]/.test(fraction.slice(6));
  const shown = BigInt(whole!).toLocaleString("en-US") + (short ? `.${short}` : "");
  return (
    <abbr title={`${exact} ${asset}`}>
      {approximate ? "≈" : ""}
      {shown} {asset}
    </abbr>
  );
}
/** Canonical inclusion plus backend publication; never sign or resend while observing. */
async function confirmedPublicTrade(
  handle: string,
  prepared: PublicTokenTradePreparedDto,
  hash: string,
  signal: AbortSignal,
) {
  const included = await publicTokenReceipt(hash, signal);
  if (included !== "confirmed" || prepared.quote.approval) {
    return included;
  }
  const response = await fetch(
    `/api/v1/marketplace/personas/${encodeURIComponent(handle)}/token/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: prepared.transaction.from, txHash: hash }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Market publication unavailable");
  }
  return publicTokenTradeConfirmationSchema.parse(await response.json()).status;
}
interface TradeDraft {
  side: "buy" | "sell";
  buyAmount: string;
  sellAmount: string;
  slippage: string;
}
const serverSnapshot = () => null;
function decodePrepared(value: unknown) {
  const parsed = publicTokenTradePreparedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
interface Props {
  handle: string;
  token: AgentTokenDto;
  preview?: boolean;
  embedded?: boolean;
  onConfirmed?: (hash: string) => void;
  previewOutcome?: "success" | "cancel" | "failure" | "pending";
}
export function PublicTokenTrade(props: Props) {
  const wallet = useWallet();
  const scope = `${props.token.chainId}.${props.token.address}.${wallet.kind}.${wallet.address}.${wallet.onTargetChain}.${props.preview ? props.previewOutcome : "live"}`;
  return <PublicTradeForm key={scope} {...props} />;
}
function PublicTradeForm({
  handle,
  token,
  preview = false,
  embedded = false,
  onConfirmed,
  previewOutcome = "success",
}: Props) {
  const wallet = useWallet();
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [phase, setPhase] = useState<"preparing" | "wallet" | "approval" | "trade" | null>(null);
  const [settledHash, setSettledHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<AbortController | null>(null);
  const approved = useRef({ buy: false, sell: false });
  const [simulated, setSimulated] = useState<PublicTradeAttempt | null>(null);
  const key = `pk.token.trade.${token.chainId}.${token.address.toLowerCase()}.${wallet.address?.toLowerCase() ?? "disconnected"}`;
  const persisted = useSyncExternalStore(
    subscribePublicTrade,
    () => readPublicTrade(key, decodePrepared),
    serverSnapshot,
  );
  const attempt = preview ? simulated : persisted;
  const [acknowledged, setAcknowledged] = useState<PublicTradeAttempt | null>(null);
  const success = attempt?.status === "confirmed" && !attempt.prepared.quote.approval;
  const celebrating = success && acknowledged !== attempt;
  useEffect(() => {
    if (!success || acknowledged === attempt) {
      return;
    }
    const timer = setTimeout(() => setAcknowledged(attempt), 2200);
    return () => clearTimeout(timer);
  }, [success, attempt, acknowledged]);
  const observing = Boolean(
    attempt?.hash &&
    ["confirming", "unknown"].includes(attempt.status) &&
    settledHash !== attempt.hash,
  );
  const displayPhase =
    phase ?? (observing ? (attempt?.prepared.quote.approval ? "approval" : "trade") : null);
  const busy = displayPhase !== null;
  const active =
    attempt !== null && !["confirmed", "reverted", "cancelled"].includes(attempt.status);
  const restored: TradeDraft = {
    side: attempt?.prepared.quote.side ?? "buy",
    buyAmount:
      attempt?.prepared.quote.side === "buy"
        ? formatUnits(BigInt(attempt.prepared.quote.amount), 6)
        : "1",
    sellAmount:
      attempt?.prepared.quote.side === "sell"
        ? formatUnits(BigInt(attempt.prepared.quote.amount), 18)
        : "1000",
    slippage: String(attempt?.prepared.quote.slippageBps ?? 50),
  };
  const form = active ? restored : (draft ?? restored);
  const { side, buyAmount, sellAmount, slippage } = form;
  const asset = side === "buy" ? "AUSD" : token.ticker;
  let amount: string | null = null;
  try {
    const units = toBaseUnits(side === "buy" ? buyAmount : sellAmount, side === "buy" ? 6 : 18);
    if (units > 0n && units < 2n ** 256n) {
      amount = units.toString();
    }
  } catch {
    /* Keep the entered amount visible. */
  }
  const estimate = usePublicTradeQuote({
    handle,
    token: token.address,
    wallet: wallet.address,
    side,
    amount,
    slippageBps: Number(slippage),
    enabled: !preview && !busy && !active && token.chainId === 10143,
    refreshKey: success ? attempt.hash : null,
  });
  function edit(next: TradeDraft) {
    setDraft(next);
    setAcknowledged(attempt);
    setError(null);
  }
  function keep(value: PublicTradeAttempt | null) {
    if (preview) {
      if (value?.status === "confirmed" && value.prepared.quote.approval) {
        approved.current[value.prepared.quote.side] = true;
      }
      setSimulated(value);
    } else {
      writePublicTrade(key, value);
    }
  }
  function previewDelay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      function abort() {
        clearTimeout(timer);
        reject(signal.reason);
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  async function requestPrepared(signal: AbortSignal, previous?: PublicTokenTradePreparedDto) {
    const wantedSide = previous?.quote.side ?? side;
    const wantedAmount = previous?.quote.amount ?? amount;
    const wantedSlippage = previous?.quote.slippageBps ?? Number(slippage);
    if (!wantedAmount) {
      throw new Error("Enter a valid amount.");
    }
    setPhase("preparing");
    let prepared: PublicTokenTradePreparedDto;
    if (preview) {
      await previewDelay(450, signal);
      const quote = quotes[wantedSide];
      prepared = {
        version: 1,
        token: token.address,
        curve: "0x3333333333333333333333333333333333333333",
        quoteToken: AUSD[10143].address,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        quote: { ...quote, side: wantedSide, approval: !approved.current[wantedSide] },
        transaction: {
          from: "0x5555555555555555555555555555555555555555",
          to: AUSD[10143].address,
          data: "0x01",
          value: "0x0",
          chainId: 10143,
          nonce: 0,
          gas: "0x186a0",
          maxFeePerGas: "0x3b9aca00",
          maxPriorityFeePerGas: "0x3b9aca00",
        },
      };
    } else {
      if (!wallet.address || !wallet.onTargetChain) {
        throw new Error("Connect your wallet on Monad testnet.");
      }
      const response = await fetch(
        `/api/v1/marketplace/personas/${encodeURIComponent(handle)}/token/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: wallet.address,
            side: wantedSide,
            amount: wantedAmount,
            slippageBps: wantedSlippage,
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
          cache: "no-store",
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(WORDS[body.error] ?? "Could not prepare the trade. No swap was sent.");
      }
      prepared = publicTokenTradePreparedSchema.parse(body.data ?? body);
      if (
        prepared.token.toLowerCase() !== token.address.toLowerCase() ||
        prepared.transaction.from.toLowerCase() !== wallet.address.toLowerCase() ||
        prepared.quote.amount !== wantedAmount ||
        prepared.quote.side !== wantedSide ||
        prepared.quote.slippageBps !== wantedSlippage
      ) {
        throw new Error("The quote does not match this trade.");
      }
    }
    signal.throwIfAborted();
    return prepared;
  }
  function observe(prepared: PublicTokenTradePreparedDto, hash: string, signal: AbortSignal) {
    setPhase(prepared.quote.approval ? "approval" : "trade");
    if (preview) {
      return waitForPublicTradeReceipt({
        signal,
        read: async (signal) => {
          await previewDelay(prepared.quote.approval ? 1500 : 1800, signal);
          if (previewOutcome === "pending" && !prepared.quote.approval) {
            return "pending";
          }
          return previewOutcome === "failure" ? "reverted" : "confirmed";
        },
      });
    }
    return waitForPublicTradeReceipt({
      signal,
      read: (signal) => confirmedPublicTrade(handle, prepared, hash, signal),
    });
  }
  async function trade() {
    if (run.current || !amount) {
      return;
    }
    const controller = new AbortController();
    run.current = controller;
    setError(null);
    let latest = attempt;
    try {
      const first =
        attempt?.status === "review" ? attempt.prepared : await requestPrepared(controller.signal);
      const result = await runPublicTokenTrade({
        prepared: first,
        approvalHash: attempt?.status === "review" ? attempt.approvalHash : undefined,
        signal: controller.signal,
        prepareNext: () => requestPrepared(controller.signal, first),
        send: async (prepared) => {
          setPhase("wallet");
          if (preview) {
            await previewDelay(1200, controller.signal);
            if (previewOutcome === "cancel") {
              throw Object.assign(new Error("cancelled"), { code: 4001 });
            }
            return "0x" + (prepared.quote.approval ? "a" : "b").repeat(64);
          }
          return wallet.sendTokenTransaction(prepared, token.address);
        },
        receipt: (hash) => observe(latest!.prepared, hash, controller.signal),
        keep: (value) => {
          latest = value;
          keep(value);
        },
      });
      if (result === "confirmed" && latest?.hash && !latest.prepared.quote.approval) {
        onConfirmed?.(latest.hash);
      }
      if (result === "review") {
        setError("Price changed. Check the updated minimum before confirming.");
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof WalletSubmissionUnknown
            ? "Wallet response lost. Check your wallet activity before another trade."
            : (caught as { code?: number }).code === 4001
              ? "Signature cancelled. Your amount is kept."
              : caught instanceof Error &&
                  (Object.values(WORDS).includes(caught.message) ||
                    /^(Could not prepare|Approval confirmed|The quote|Enter a valid)/.test(
                      caught.message,
                    ))
                ? caught.message
                : "Could not complete the wallet request. Your amount is kept.",
        );
      }
    } finally {
      if (run.current === controller) {
        run.current = null;
      }
      if (!controller.signal.aborted) {
        setSettledHash(latest?.hash ?? null);
        setPhase(null);
      }
    }
  }
  const restore = useEffectEvent(
    async (
      saved: PublicTradeAttempt,
      result: "pending" | "confirmed" | "reverted",
      controller: AbortController,
    ) => {
      try {
        controller.signal.throwIfAborted();
        keep({ ...saved, status: result === "pending" ? "confirming" : result });
        if (result === "confirmed" && saved.prepared.quote.approval) {
          const prepared = await requestPrepared(controller.signal, saved.prepared);
          keep({ prepared, status: "review", hash: null, approvalHash: saved.hash! });
        } else if (result === "confirmed") {
          onConfirmed?.(saved.hash!);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("Could not finish checking this transaction. Its hash is kept.");
        }
      } finally {
        if (run.current === controller) {
          run.current = null;
        }
        if (!controller.signal.aborted) {
          setSettledHash(saved.hash);
          setPhase(null);
        }
      }
    },
  );
  const readRestored = useEffectEvent(async (saved: PublicTradeAttempt, signal: AbortSignal) => {
    const result = await confirmedPublicTrade(handle, saved.prepared, saved.hash!, signal);
    signal.throwIfAborted();
    if (result === "pending") {
      keep({ ...saved, status: "confirming" });
      setPhase(saved.prepared.quote.approval ? "approval" : "trade");
    }
    return result;
  });
  const observedHash = attempt?.hash;
  useEffect(() => {
    if (preview || !observedHash || run.current) {
      return;
    }
    const saved = readPublicTrade(key, decodePrepared);
    if (
      !saved ||
      settledHash === saved.hash ||
      (!["confirming", "unknown"].includes(saved.status) &&
        !(saved.status === "confirmed" && !saved.prepared.quote.approval))
    ) {
      return;
    }
    const controller = new AbortController();
    run.current = controller;
    void waitForPublicTradeReceipt({
      signal: controller.signal,
      read: (signal) => readRestored(saved, signal),
    }).then(
      (result) => restore(saved, result, controller),
      () => {
        if (run.current === controller) {
          run.current = null;
        }
      },
    );
    return () => {
      controller.abort();
      if (run.current === controller) {
        run.current = null;
      }
    };
  }, [key, observedHash, preview, settledHash]);
  useEffect(() => () => run.current?.abort(), []);

  const savedQuote = attempt?.prepared.quote;
  const quote = preview
    ? quotes[side]
    : (busy || active) &&
        savedQuote?.side === side &&
        savedQuote.amount === amount &&
        savedQuote.slippageBps === Number(slippage)
      ? savedQuote
      : estimate.quoted?.quote;
  const outputAsset = side === "buy" ? token.ticker.replace(/^\$+/, "") : "AUSD";
  const outputDecimals = side === "buy" ? 18 : 6;
  const ticker = token.ticker.replace(/^\$+/, "");
  const approvalHash =
    attempt?.approvalHash ?? (attempt?.prepared.quote.approval ? attempt.hash : null);
  const tradeHash = attempt && !attempt.prepared.quote.approval ? attempt.hash : null;
  let actionState: TradeActionState = "ready";
  let actionLabel = `${side === "buy" ? "Buy" : "Sell"} ${ticker}`;
  let actionHint: string | undefined;
  if (displayPhase) {
    actionState = displayPhase;
    if (displayPhase === "preparing") {
      actionLabel = "Getting your quote";
    } else if (displayPhase === "wallet") {
      actionLabel = "Confirm in wallet";
    } else if (displayPhase === "approval") {
      actionLabel = `Approving ${side === "buy" ? "AUSD" : ticker}`;
    } else {
      actionLabel = `${side === "buy" ? "Buying" : "Selling"} ${ticker}`;
    }
  } else if (active && attempt?.status !== "review") {
    actionState = attempt?.hash ? "pending" : "unknown";
    actionLabel = attempt?.hash ? "Still pending" : "Wallet response lost";
    actionHint = attempt?.hash ? "Your transaction is saved" : "Check your wallet before retrying";
  } else if (error || attempt?.status === "reverted") {
    actionState = "error";
    actionLabel = error?.startsWith("Signature cancelled")
      ? "Cancelled · try again"
      : `Retry ${side}`;
    actionHint = error ?? "Transaction failed. No swap completed.";
    if (error?.startsWith("Price changed")) {
      actionState = "review";
      actionLabel = `Confirm ${side}`;
      actionHint = "Price changed · review the minimum";
    }
  } else if (celebrating) {
    actionState = "success";
    actionLabel = `${side === "buy" ? "Bought" : "Sold"} ${ticker}`;
  } else if (attempt?.status === "review") {
    actionState = "review";
    actionLabel = `Confirm ${side}`;
  }
  return (
    <section
      className={`${styles.panel} ${embedded ? styles.embedded : ""}`}
      aria-label="Trade token publicly"
    >
      <div className={styles.head}>
        <h2>Trade token</h2>
        {token.chainId !== 10143 && <Tag>UNSUPPORTED NETWORK</Tag>}
      </div>
      <Segmented
        label="Public trade side"
        tone="lime"
        className={styles.choices}
        value={side}
        disabled={busy || active}
        options={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ]}
        onChange={(v) => edit({ ...form, side: v as "buy" | "sell" })}
      />
      <Field label={`You pay · ${asset}`}>
        <Input
          aria-label={`Public amount · ${asset}`}
          inputMode="decimal"
          value={side === "buy" ? buyAmount : sellAmount}
          maxLength={80}
          disabled={busy || active}
          readOnly={preview}
          onChange={(e) =>
            edit({ ...form, [side === "buy" ? "buyAmount" : "sellAmount"]: e.target.value })
          }
        />
      </Field>
      <dl className={styles.quote} aria-label="Trade estimate" aria-busy={estimate.loading}>
        <div className={styles.receive}>
          <dt>You receive · {outputAsset}</dt>
          <dd key={quote?.expectedOutput ?? "empty"}>
            {quote ? (
              quotedAmount(quote.expectedOutput, outputDecimals, outputAsset)
            ) : estimate.loading ? (
              <span className={styles.quoteLoading} aria-label="Loading quote">
                …
              </span>
            ) : estimate.unavailable ? (
              <span className={styles.quiet}>Quote unavailable</span>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Minimum received</dt>
          <dd>{quote ? quotedAmount(quote.minimumOutput, outputDecimals, outputAsset) : "—"}</dd>
        </div>
      </dl>
      <div className={styles.head}>
        <span className={styles.quiet}>Slippage limit</span>
        <Segmented
          label="Public slippage limit"
          tone="lime"
          className={styles.choices}
          value={slippage}
          disabled={busy || active || preview}
          options={[
            { value: "50", label: "0.5%" },
            { value: "100", label: "1%" },
          ]}
          onChange={(slippage) => edit({ ...form, slippage })}
        />
      </div>
      {!preview && wallet.address && (
        <p className={styles.quiet}>
          Your wallet · {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </p>
      )}

      <div className={styles.actions}>
        {!preview && wallet.status !== "connected" ? (
          <Button
            disabled={wallet.status === "connecting"}
            onClick={() => wallet.connect(`Trade ${token.ticker}`)}
          >
            {wallet.restoring ? "Reconnecting…" : "Connect wallet"}
          </Button>
        ) : !preview && !wallet.onTargetChain ? (
          <Button onClick={() => void wallet.switchChain()}>Switch to Monad testnet</Button>
        ) : (
          <PublicTradeAction
            state={actionState}
            label={actionLabel}
            hint={actionHint}
            disabled={
              busy ||
              celebrating ||
              !amount ||
              token.chainId !== 10143 ||
              (active && attempt?.status !== "review")
            }
            busy={busy}
            onClick={() => void trade()}
          />
        )}
        {attempt?.status === "review" && !busy && (
          <Button
            variant="secondary"
            onClick={() => {
              edit(form);
              keep({ ...attempt, status: "cancelled" });
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      <p className={styles.quiet}>1% curve fee · gas in MON</p>
      {(approvalHash || tradeHash) && (
        <dl className={styles.transactions} aria-label="Transaction receipts">
          {approvalHash && (
            <div className={styles.transaction}>
              <dt>Approval</dt>
              <dd>
                <ChainReference
                  value={approvalHash}
                  chainId={token.chainId}
                  kind="tx"
                  label="approval transaction"
                  preview={preview}
                />
              </dd>
            </div>
          )}
          {tradeHash && tradeHash !== approvalHash && (
            <div className={styles.transaction}>
              <dt>{attempt?.prepared.quote.side === "buy" ? "Buy" : "Sell"}</dt>
              <dd>
                <ChainReference
                  value={tradeHash}
                  chainId={token.chainId}
                  kind="tx"
                  label={`${attempt?.prepared.quote.side} transaction`}
                  preview={preview}
                />
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

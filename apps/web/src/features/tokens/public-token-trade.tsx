"use client";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import {
  publicTokenTradePreparedSchema,
  type AgentTokenDto,
  type PublicTokenTradePreparedDto,
} from "@pickler/api-schema";
import { AUSD, toBaseUnits } from "@pickler/chain";
import { formatUnits } from "viem";
import { Button, Field, Icon, Input, Segmented, Tag } from "@pickler/ui";
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
}
export function PublicTokenTrade(props: Props) {
  const wallet = useWallet();
  const scope = `${props.token.chainId}.${props.token.address}.${wallet.kind}.${wallet.address}.${wallet.onTargetChain}`;
  return <PublicTradeForm key={scope} {...props} />;
}
function PublicTradeForm({ handle, token, preview = false, embedded = false, onConfirmed }: Props) {
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
  const observing = Boolean(
    attempt?.hash &&
    ["confirming", "unknown"].includes(attempt.status) &&
    settledHash !== attempt.hash,
  );
  const displayPhase =
    phase ?? (observing ? (attempt?.prepared.quote.approval ? "approval" : "trade") : null);
  const busy = displayPhase !== null;
  const active = attempt !== null && !["confirmed", "reverted"].includes(attempt.status);
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
      return new Promise<"confirmed">((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve("confirmed");
        }, 900);
        function abort() {
          clearTimeout(timer);
          reject(signal.reason);
        }
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    return waitForPublicTradeReceipt({
      signal,
      read: (signal) => publicTokenReceipt(hash, signal),
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
        signal: controller.signal,
        prepareNext: () => requestPrepared(controller.signal, first),
        send: async (prepared) => {
          setPhase("wallet");
          return preview
            ? "0x" + "a".repeat(64)
            : wallet.sendTokenTransaction(prepared, token.address);
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
          keep({ prepared, status: "review", hash: null });
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
  const observedHash = attempt?.hash;
  useEffect(() => {
    if (preview || !observedHash || run.current) {
      return;
    }
    const saved = readPublicTrade(key, decodePrepared);
    if (!saved || !["confirming", "unknown"].includes(saved.status)) {
      return;
    }
    const controller = new AbortController();
    run.current = controller;
    void waitForPublicTradeReceipt({
      signal: controller.signal,
      read: (signal) => publicTokenReceipt(saved.hash!, signal),
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
  }, [key, observedHash, preview]);
  useEffect(() => () => run.current?.abort(), []);

  const quote = attempt?.prepared.quote;
  const outputAsset = quote?.side === "buy" ? token.ticker : "AUSD";
  const outputDecimals = quote?.side === "buy" ? 18 : 6;
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
        onChange={(v) => setDraft({ ...form, side: v as "buy" | "sell" })}
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
            setDraft({ ...form, [side === "buy" ? "buyAmount" : "sellAmount"]: e.target.value })
          }
        />
      </Field>
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
          onChange={(slippage) => setDraft({ ...form, slippage })}
        />
      </div>
      {!preview && wallet.address && (
        <p className={styles.quiet}>
          Your wallet · {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </p>
      )}
      {quote && active && (
        <dl className={styles.quote}>
          <div>
            <dt>Expected</dt>
            <dd>{quotedAmount(quote.expectedOutput, outputDecimals, outputAsset)}</dd>
          </div>
          <div>
            <dt>Minimum</dt>
            <dd>{quotedAmount(quote.minimumOutput, outputDecimals, outputAsset)}</dd>
          </div>
        </dl>
      )}
      {!busy && attempt?.status === "confirmed" && (
        <p className={styles.status} role="status">
          {quote?.approval
            ? "Approval confirmed."
            : quote?.side === "buy"
              ? "Purchase confirmed."
              : "Sale confirmed."}
        </p>
      )}
      {attempt?.status === "reverted" && (
        <p role="alert" className={styles.error}>
          Transaction failed. No swap completed.
        </p>
      )}
      {attempt?.hash && (
        <div className={styles.transaction}>
          <span>{quote?.approval ? "Approval" : "Transaction"}</span>
          <ChainReference
            value={attempt.hash}
            chainId={token.chainId}
            kind="tx"
            label="trade transaction"
            preview={preview}
          />
        </div>
      )}
      {!busy && attempt?.status === "confirming" && (
        <p className={styles.quiet} role="status">
          Still pending on Monad. Follow the transaction above.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {!preview && wallet.status !== "connected" ? (
          <Button onClick={() => wallet.connect(`Trade ${token.ticker}`)}>Connect wallet</Button>
        ) : !preview && !wallet.onTargetChain ? (
          <Button onClick={() => void wallet.switchChain()}>Switch to Monad testnet</Button>
        ) : (
          <Button
            disabled={
              busy || !amount || token.chainId !== 10143 || (active && attempt?.status !== "review")
            }
            aria-busy={busy}
            aria-live="polite"
            onClick={() => void trade()}
          >
            {busy && <Icon name="refresh" size={16} className={styles.spinner} />}
            {displayPhase === "preparing"
              ? "Preparing…"
              : displayPhase === "wallet"
                ? "Confirm in wallet…"
                : displayPhase === "approval"
                  ? "Confirming approval…"
                  : displayPhase === "trade"
                    ? "Confirming trade…"
                    : active && attempt?.status !== "review"
                      ? attempt?.hash
                        ? "Pending on Monad"
                        : "Wallet response unavailable"
                      : attempt?.status === "review"
                        ? `Confirm ${side}`
                        : `${side === "buy" ? "Buy" : "Sell"} token`}
          </Button>
        )}
        {attempt?.status === "review" && !busy && (
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(form);
              keep(null);
              setError(null);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      <p className={styles.quiet}>1% curve fee · gas in MON</p>
    </section>
  );
}

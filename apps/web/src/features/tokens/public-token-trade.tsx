"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  publicTokenTradePreparedSchema,
  type AgentTokenDto,
  type PublicTokenTradePreparedDto,
} from "@pickler/api-schema";
import { AUSD, toBaseUnits } from "@pickler/chain";
import { formatUnits } from "viem";
import { Button, Field, Input, Segmented, Skeleton, Tag } from "@pickler/ui";
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
  PROVIDER_UNAVAILABLE: "Could not read the network. No transaction was sent.",
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
export function PublicTokenTrade({
  handle,
  token,
  preview = false,
}: {
  handle: string;
  token: AgentTokenDto;
  preview?: boolean;
}) {
  const wallet = useWallet();
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(false);
  const [approved, setApproved] = useState({ buy: false, sell: false });
  const [simulated, setSimulated] = useState<PublicTradeAttempt | null>(null);
  const key = `pk.token.trade.${token.chainId}.${token.address.toLowerCase()}.${wallet.address?.toLowerCase() ?? "disconnected"}`;
  const persisted = useSyncExternalStore(
    subscribePublicTrade,
    () => readPublicTrade(key, decodePrepared),
    serverSnapshot,
  );
  const attempt = preview ? simulated : persisted;
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
      setSimulated(value);
    } else {
      writePublicTrade(key, value);
    }
  }
  async function prepare() {
    if (gate.current || !amount) {
      return;
    }
    gate.current = true;
    setBusy(true);
    setError(null);
    try {
      let prepared: PublicTokenTradePreparedDto;
      if (preview) {
        const quote = quotes[side];
        prepared = {
          version: 1,
          token: token.address,
          curve: "0x3333333333333333333333333333333333333333",
          quoteToken: AUSD[10143].address,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          quote: { ...quote, side, approval: !approved[side] },
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
              side,
              amount,
              slippageBps: Number(slippage),
            }),
            signal: AbortSignal.timeout(20_000),
            cache: "no-store",
          },
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(
            WORDS[body.error] ?? "Could not prepare the trade. No transaction was sent.",
          );
        }
        prepared = publicTokenTradePreparedSchema.parse(body.data ?? body);
        if (
          prepared.token.toLowerCase() !== token.address.toLowerCase() ||
          prepared.transaction.from.toLowerCase() !== wallet.address.toLowerCase() ||
          prepared.quote.amount !== amount ||
          prepared.quote.side !== side ||
          prepared.quote.slippageBps !== Number(slippage)
        ) {
          throw new Error("The quote does not match this trade.");
        }
      }
      keep({ prepared, status: "review", hash: null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare the trade.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function sign() {
    if (!attempt || attempt.status !== "review" || gate.current) {
      return;
    }
    gate.current = true;
    setBusy(true);
    setError(null);
    try {
      keep({ ...attempt, status: "submitting" });
      if (preview) {
        keep({ ...attempt, status: "confirming", hash: null });
      } else {
        const hash = await wallet.sendTokenTransaction(attempt.prepared, token.address);
        keep({ ...attempt, status: "confirming", hash });
      }
    } catch (caught) {
      if (caught instanceof WalletSubmissionUnknown) {
        keep({ ...attempt, status: "unknown", hash: caught.hash });
        setError(caught.message);
      } else {
        try {
          keep(attempt);
        } catch {
          setError("Local transaction storage is unavailable. No transaction was sent.");
          return;
        }
        setError(
          (caught as { code?: number }).code === 4001
            ? "Signature cancelled. Your amount is preserved."
            : caught instanceof Error
              ? caught.message
              : "Signature failed.",
        );
      }
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function status() {
    if (!attempt || gate.current) {
      return;
    }
    gate.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = preview
        ? "confirmed"
        : attempt.hash
          ? await publicTokenReceipt(attempt.hash)
          : "pending";
      if (preview && result === "confirmed" && attempt.prepared.quote.approval) {
        setApproved((value) => ({ ...value, [attempt.prepared.quote.side]: true }));
      }
      keep({ ...attempt, status: result === "pending" ? "confirming" : result });
    } catch {
      setError(
        "Could not check the transaction. Check again explicitly; it will not be sent again.",
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  const quote = attempt?.prepared.quote;
  const outputAsset = quote?.side === "buy" ? token.ticker : "AUSD";
  const outputDecimals = quote?.side === "buy" ? 18 : 6;
  return (
    <section className={styles.panel} aria-label="Trade token publicly">
      <div className={styles.head}>
        <h2>Trade ${token.ticker}</h2>
        <Tag>
          {preview
            ? "SIMULATED · TESTNET"
            : token.chainId === 10143
              ? "MONAD TESTNET"
              : "UNSUPPORTED NETWORK"}
        </Tag>
      </div>
      <Segmented
        label="Public trade side"
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
      {busy && <Skeleton shape="line" />}
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
          <div>
            <dt>Curve fee</dt>
            <dd>1% · included</dd>
          </div>
        </dl>
      )}
      {attempt && (
        <p className={styles.status} role="status">
          {attempt.status === "review"
            ? quote?.approval
              ? `Approve exactly ${formatUnits(BigInt(quote.amount), quote.side === "buy" ? 6 : 18)} ${quote.side === "buy" ? "AUSD" : token.ticker}. Then review the trade separately.`
              : "Review this trade before signing."
            : attempt.status === "submitting"
              ? "Awaiting wallet confirmation…"
              : attempt.status === "confirming"
                ? "Confirming · check status explicitly"
                : attempt.status === "confirmed"
                  ? quote?.approval
                    ? "Approval confirmed. Review the trade again."
                    : "Trade confirmed."
                  : attempt.status === "reverted"
                    ? "Transaction reverted. No swap completed."
                    : "Submission uncertain. Check your wallet activity before starting another trade."}
        </p>
      )}
      {attempt?.hash && <p className={styles.hash}>Transaction · {attempt.hash}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {attempt?.status === "review" ? (
          <>
            <Button
              disabled={busy || (!preview && !wallet.onTargetChain)}
              onClick={() => void sign()}
            >
              {preview
                ? "Simulate confirmation"
                : quote?.approval
                  ? "Approve in wallet"
                  : `Confirm ${quote?.side} in wallet`}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(form);
                keep(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : attempt && ["confirming", "unknown"].includes(attempt.status) ? (
          <Button disabled={busy || (!preview && !attempt.hash)} onClick={() => void status()}>
            Check transaction
          </Button>
        ) : attempt?.status === "submitting" ? null : !preview && wallet.status !== "connected" ? (
          <Button onClick={() => wallet.connect(`Trade ${token.ticker}`)}>Connect wallet</Button>
        ) : !preview && !wallet.onTargetChain ? (
          <Button onClick={() => void wallet.switchChain()}>Switch to Monad testnet</Button>
        ) : (
          <Button
            disabled={busy || !amount || token.chainId !== 10143}
            onClick={() => void prepare()}
          >
            Review {side}
          </Button>
        )}
      </div>
      <p className={styles.quiet}>
        Buy with AUSD. Sell for AUSD. Gas in MON. Your wallet signs each approval and trade.
      </p>
      <p className={styles.quiet}>
        Curve trading only · DEX swaps become available in a separate integration.
      </p>
    </section>
  );
}

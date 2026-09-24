"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input } from "@pickler/ui";
import { liveOrderSchema, tradingAccountSchema } from "@pickler/api-schema";
import { consoleApi, type Agent, type Config } from "../api";
import { startPolling } from "../lib/polling";
import styles from "../studio.module.css";

type Order = ReturnType<typeof liveOrderSchema.parse>;
type Account = ReturnType<typeof tradingAccountSchema.parse>;
export function Trading({
  agent,
  canManage,
  onSave,
}: {
  agent: Agent;
  canManage: boolean;
  onSave(config: Config): void;
}) {
  const id = agent.productId ?? agent.id;
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [prepared, setPrepared] = useState<Order | null>(null);
  const [request, setRequest] = useState({
    marketId: "",
    outcomeId: "",
    limitPrice: "",
    budget: "5",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const prepareKey = useRef(crypto.randomUUID());
  const submitKey = useRef(crypto.randomUUID());
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const [next, history] = await Promise.all([
        consoleApi<unknown>(`/agents/${id}/trading/account`, { signal: signal ?? null }),
        consoleApi<{ orders: unknown[] }>(`/agents/${id}/trading/orders`, {
          signal: signal ?? null,
        }),
      ]);
      if (signal?.aborted) {
        return false;
      }
      const parsed = liveOrderSchema.array().parse(history.orders);
      setAccount(tradingAccountSchema.parse(next));
      setOrders(parsed);
      return parsed.some((order) => ["queued", "submitting", "unknown"].includes(order.status));
    },
    [id],
  );
  const pending = orders.some((order) =>
    ["queued", "submitting", "unknown"].includes(order.status),
  );
  useEffect(() => {
    return startPolling(
      async (signal) => ((await refresh(signal)) ? 3000 : null),
      () => setError("Trading unavailable or account not yet enabled by the operator"),
    );
  }, [pending, refresh]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trading failed");
    } finally {
      setBusy(false);
    }
  };
  const disabled = !canManage || busy || !account?.enabled;
  const mode = (value: "off" | "manual" | "automatic") =>
    onSave({ ...agent.config, trading: { version: 1, mode: value } });
  return (
    <section className={styles.section}>
      <h2>Polymarket pilot</h2>
      <p>
        Real funds. Up to 5 pUSD per purchase and 10 pUSD total. One manual purchase, then one
        autonomous purchase.
      </p>
      {error && <p role="alert">{error}</p>}
      {account && (
        <dl>
          <dt>Wallet</dt>
          <dd>{account.wallet}</dd>
          <dt>Reserved maximum</dt>
          <dd>{account.reservedMicros / 1e6} pUSD</dd>
          <dt>Confirmed purchase upper bounds</dt>
          <dd>{account.spentMicros / 1e6} pUSD</dd>
        </dl>
      )}
      {balance !== null && <p>Last checked balance: {balance} pUSD</p>}
      <Button
        disabled={disabled}
        onClick={() =>
          void action(async () => {
            const result = await consoleApi<{
              balance: string;
              approved: boolean;
              blocked: boolean;
            }>(`/agents/${id}/trading/check`, {
              method: "POST",
              headers: { "Idempotency-Key": crypto.randomUUID() },
              body: "{}",
            });
            setBalance(result.balance);
            if (result.blocked || !result.approved) {
              throw new Error("Trading access or approvals are unavailable");
            }
          })
        }
      >
        Check connection
      </Button>
      <p>
        Mode: {agent.config.trading?.mode ?? "off"}. Enable the Polymarket and Polymarket trading
        plugins in Skills before buying.
      </p>
      <Button disabled={disabled} onClick={() => mode("manual")}>
        Enable manual mode
      </Button>
      <Button
        disabled={
          disabled ||
          !orders.some((o) => o.origin === "manual" && o.status === "settled") ||
          orders.some((o) => o.origin === "agent" && o.status === "settled")
        }
        onClick={() => mode("automatic")}
      >
        Authorize one autonomous purchase
      </Button>
      <Button disabled={!canManage || busy} onClick={() => mode("off")}>
        Stop new purchases
      </Button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            setPrepared(
              liveOrderSchema.parse(
                await consoleApi(`/agents/${id}/trading/prepare`, {
                  method: "POST",
                  headers: { "Idempotency-Key": prepareKey.current },
                  body: JSON.stringify(request),
                }),
              ),
            );
          });
        }}
      >
        {(["marketId", "outcomeId", "limitPrice", "budget"] as const).map((name) => (
          <Field key={name} label={name}>
            <Input
              required
              value={request[name]}
              onChange={(e) => {
                setRequest({ ...request, [name]: e.target.value });
                setPrepared(null);
                prepareKey.current = crypto.randomUUID();
                submitKey.current = crypto.randomUUID();
              }}
            />
          </Field>
        ))}
        <Button type="submit" disabled={disabled}>
          Preview purchase
        </Button>
      </form>
      {prepared && (
        <div>
          <h3>Confirm real purchase</h3>
          <p>{prepared.preview.market.question}</p>
          <p>
            Outcome:{" "}
            {prepared.preview.market.outcomes?.find(
              (outcome) => outcome.id === prepared.preview.outcomeId,
            )?.label ?? prepared.preview.outcomeId}
            ; maximum price: {prepared.preview.limitPrice}; maximum spend: {prepared.preview.budget}{" "}
            pUSD.
          </p>
          <p>Expires: {new Date(prepared.expiresAt).toLocaleString()}</p>
          <Button
            disabled={disabled}
            onClick={() =>
              void action(async () => {
                await consoleApi(`/trading/orders/${prepared.id}/submit`, {
                  method: "POST",
                  headers: { "Idempotency-Key": submitKey.current },
                  body: "{}",
                });
                setPrepared(null);
                await refresh();
              })
            }
          >
            Confirm and submit purchase
          </Button>
        </div>
      )}
      {account?.automaticAttempt && (
        <p>
          Autonomous attempt:{" "}
          {account.automaticAttempt.reason ?? "Recorded; see order history for its outcome"}. No
          automatic retry.
        </p>
      )}
      <h3>Orders and confirmed purchases</h3>
      {orders.map((order) => (
        <article key={order.id}>
          <p>
            {order.preview.market.question} — {order.origin}: {order.status}
          </p>
          {order.reason && <p>{order.reason}</p>}
          {order.fill && (
            <p>{order.fill.shares} shares confirmed. This does not mean the event has resolved.</p>
          )}
          {order.fill?.transactionHashes.map((hash) => (
            <p key={hash}>{hash}</p>
          ))}
        </article>
      ))}
    </section>
  );
}

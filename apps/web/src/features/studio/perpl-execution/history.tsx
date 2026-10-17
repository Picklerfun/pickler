"use client";
import { useEffect, useRef, useState } from "react";
import type { PerplLiveHistoryDto } from "@pickler/api-schema";
import { Button } from "@pickler/ui";
import { ChainReference } from "@/features/tokens/chain-reference";
import { perplTradingHistory } from "../api";
import { timestamp } from "./presentation";
import styles from "./execution.module.css";

type Kind = PerplLiveHistoryDto["kind"];
/** User-requested archive pages, independent of operational polling and financial commands. */
export function PerplHistoryArchive({ agentId }: { agentId: string }) {
  const [kind, setKind] = useState<Kind>("orders");
  const [pages, setPages] = useState<PerplLiveHistoryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const next = pages.at(-1)?.nextCursor;
  async function load(category: Kind, reset = false) {
    if (pending.current || (!reset && next === null)) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const page = await perplTradingHistory(
        agentId,
        category,
        reset ? undefined : (next ?? undefined),
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setPages((current) => (reset ? [page] : [...current, page]));
      }
    } catch {
      if (!controller.signal.aborted) {
        setFailed(true);
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
      }
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }
  const items = [
    ...new Map(
      pages
        .flatMap<PerplLiveHistoryDto["items"][number]>((p) => p.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  return (
    <details className={styles.orderDetails}>
      <summary>Browse complete execution history</summary>
      <div className={styles.links} aria-label="History category">
        {(["orders", "sessions", "setup"] as const).map((category) => (
          <Button
            key={category}
            variant="secondary"
            disabled={busy}
            aria-pressed={kind === category}
            onClick={() => {
              setKind(category);
              setPages([]);
              void load(category, true);
            }}
          >
            {category === "setup" ? "Account steps" : category === "orders" ? "Orders" : "Sessions"}
          </Button>
        ))}
      </div>
      <ul className={styles.orderList} aria-live="polite">
        {items.map((item) => (
          <li key={item.id} className={styles.order}>
            <strong>
              {"symbol" in item
                ? item.symbol
                : "kind" in item
                  ? item.kind.replaceAll("_", " ")
                  : "Session"}
            </strong>
            <span>{item.status}</span>
            {"createdAt" in item && (
              <time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>
            )}
            <span className={styles.note}>
              {"requestId" in item ? `Request #${item.requestId}` : item.id}
            </span>
            <details className={styles.orderDetails}>
              <summary>Recorded details</summary>
              <dl className={styles.detailGrid}>
                {"filledSize" in item && (
                  <>
                    <div>
                      <dt>Filled size</dt>
                      <dd>{item.filledSize ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Fill price</dt>
                      <dd>{item.fillPrice ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Fee · AUSD</dt>
                      <dd>{item.feeAusd ?? "Unknown"}</dd>
                    </div>
                  </>
                )}
                {"settings" in item && (
                  <>
                    <div>
                      <dt>Margin · AUSD</dt>
                      <dd>{item.settings.marginAusd}</dd>
                    </div>
                    <div>
                      <dt>Leverage</dt>
                      <dd>{item.settings.leverage}</dd>
                    </div>
                    <div>
                      <dt>Completed cycles</dt>
                      <dd>{item.completedCycles}</dd>
                    </div>
                  </>
                )}
                {"collateralAusd" in item && (
                  <div>
                    <dt>Amount · AUSD</dt>
                    <dd>{item.collateralAusd}</dd>
                  </div>
                )}
              </dl>
              {("txHashes" in item
                ? item.txHashes
                : "txHash" in item && item.txHash
                  ? [item.txHash]
                  : []
              ).map((hash) => (
                <ChainReference
                  key={hash}
                  value={hash}
                  chainId={10143}
                  kind="tx"
                  label="Recorded transaction"
                  preview={false}
                />
              ))}
              {item.error && <p className={styles.note}>{item.error}</p>}
            </details>
          </li>
        ))}
      </ul>
      {failed && <p role="status">History could not load. Retry the same page.</p>}
      {pages.length > 0 && items.length === 0 && (
        <p className={styles.note}>No recorded history.</p>
      )}
      {(pages.length === 0 || next !== null) && (
        <Button variant="secondary" disabled={busy} onClick={() => void load(kind)}>
          {busy
            ? "Loading…"
            : failed
              ? "Retry history"
              : pages.length
                ? "Load older history"
                : "Load history"}
        </Button>
      )}
    </details>
  );
}

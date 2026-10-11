import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ptsEvidence, ptsTime } from "@pickler/trading/testing/pts";
import { profileProposals, type PerpsSmaReentryConfig } from "@pickler/trading/evaluation";
import {
  initialPaperAccount,
  simulatePerpsFill,
  applyPaperFill,
  paperRisk,
} from "@pickler/trading/perps";
test("SMA proposals and full financial path remain identical to preserved tested 0bf07d7 code", async () => {
  const frozen = JSON.parse(
    await readFile(new URL("./pts-sma-baseline.json", import.meta.url), "utf8"),
  );
  assert.equal(frozen.sourceCommit, "0bf07d70037878da1edb93cc8325c7d9d1670b32");
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  for (const saved of frozen.cases) {
    const short = Boolean(saved.short),
      evidence = ptsEvidence(ptsTime, short, "0.40", hash);
    const config = {
      version: 7,
      protocol: "perps-sma-reentry-latency-v1",
      tenantId: "compatibility",
      sessionId: "frozen-compatibility",
      network: "mainnet",
      hours: 6,
      budgetUsd: "5",
      markets: evidence.frames.map((f) => ({
        symbol: f.snapshot.market.symbol,
        marketId: f.snapshot.market.marketId,
      })),
      acquisitionPolicy: "stream-universe-component-paper-20s-v1",
    } as PerpsSmaReentryConfig;
    const account = initialPaperAccount({ ...config, agentId: "sma-reference" }, 1, ptsTime);
    account.riskManagement = "buffered-selective-1x-v1";
    const proposals = profileProposals({ evidence, account }, config, "sma-reference");
    const intent = {
      kind: "open" as const,
      symbol: "BTC",
      side: short ? ("short" as const) : ("long" as const),
      notional: "100",
      feeReserve: "1",
    };
    const attempt = {
      key: "frozen-open",
      intent,
      status: "pending" as const,
      reserved: "101",
      createdAt: ptsTime,
      finishedAt: null,
      reason: null,
      evidence: null,
    };
    const frame = evidence.frames.find((f) => f.snapshot.market.symbol === "BTC")!;
    const fill = simulatePerpsFill(account, intent, frame, ptsTime),
      opened = applyPaperFill(account, attempt, fill, ptsTime);
    const closeAt = ptsTime + 60000,
      closingEvidence = ptsEvidence(closeAt, short, "0.61", hash),
      closingFrame = closingEvidence.frames.find((f) => f.snapshot.market.symbol === "BTC")!;
    const closeIntent = {
        kind: "close" as const,
        symbol: "BTC",
        side: intent.side,
        notional: "0",
        feeReserve: "1",
      },
      closeAttempt = {
        ...attempt,
        key: "frozen-close",
        intent: closeIntent,
        reserved: "0",
        createdAt: closeAt,
      };
    assert.equal(
      hash({
        evidence,
        config,
        account,
        intent,
        attempt,
        frame,
        closeAt,
        closingFrame,
        closeIntent,
        closeAttempt,
      }),
      saved.inputHash,
    );
    const closeFill = simulatePerpsFill(opened.account, closeIntent, closingFrame, closeAt),
      closed = applyPaperFill(opened.account, closeAttempt, closeFill, closeAt);
    const current = {
      proposals,
      fill,
      opened,
      risk: paperRisk(opened.account, [], ptsTime),
      closeFill,
      closed,
    };
    assert.deepEqual(JSON.parse(JSON.stringify(current)), saved.expected);
  }
});

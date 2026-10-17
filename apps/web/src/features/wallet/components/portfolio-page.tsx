"use client";

import type { AgentReadDto, AgentSummaryDto } from "@pickler/api-schema";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink, Icon } from "@pickler/ui";
import { WrongNetwork } from "@/features/status/wrong-network";
import styles from "./portfolio-page.module.css";
import { ConnectGate } from "./connect-gate";
import { useWallet } from "../lib/wallet-context";
import { formatBalance, shortAddress, TARGET_CHAIN } from "../lib/provider";
import { formatAmount } from "@/features/markets/lib/format";
import { formatProbability } from "@/features/agents/lib/format";

/**
 * Legacy wallet entry: native balance and public reads. Perpl positions live in the dedicated
 * read-only dashboard. Positions and token holdings are unmeasured here, so their counts stay
 * unknown and their panels point to the relevant public routes instead of inventing zeroes.
 */

type TabKey = "positions" | "backed" | "reads";
type StateTone = "good" | "caution" | "loss";

/** The two clocks, as one chip. The words are the ones /reads already uses for the same states. */
function readState(read: AgentReadDto): { label: string; tone: StateTone } {
  if (read.delivery === "failed") {
    return { label: "EXPIRED · REFUNDED", tone: "loss" };
  }
  if (read.delivery === "preparing") {
    return { label: "PREPARING", tone: "caution" };
  }
  switch (read.evaluation) {
    case "pending":
      return { label: `IN WINDOW · ${(read.evaluatesIn ?? "24h").toUpperCase()}`, tone: "caution" };
    case "happened":
      return { label: "SETTLED · HAPPENED", tone: "good" };
    case "missed":
      return { label: "SETTLED · DID NOT HAPPEN", tone: "loss" };
    case "not_evaluable":
      return { label: "NOT EVALUABLE", tone: "caution" };
    default:
      return { label: "DELIVERED", tone: "good" };
  }
}

export function PortfolioPage({
  agents,
  reads,
  openTab,
  preview = false,
}: {
  agents: AgentSummaryDto[];
  reads: AgentReadDto[];
  /** Which tab `?tab=` asked for, so one of these can be linked to and so each can be checked. */
  openTab?: TabKey | undefined;
  /**
   * Render the connected screen without a wallet. Dev only, and the banner says so on the page —
   * see the guard in app/portfolio/page.tsx. Without it this screen sits behind a connect gate no
   * headless browser can pass, which is why it went unverified for as long as it did.
   */
  preview?: boolean;
}) {
  const wallet = useWallet();

  const spent = reads.reduce(
    (total, read) => total + (read.delivery === "failed" ? 0 : read.paid),
    0,
  );
  const refunded = reads.reduce(
    (total, read) => total + (read.delivery === "failed" ? read.paid : 0),
    0,
  );
  const awaiting = reads.filter(
    (read) => read.delivery === "delivered" && read.evaluation === "pending",
  ).length;

  const tabs = [
    { key: "positions" as const, label: "Positions", count: null },
    { key: "backed" as const, label: "Backed", count: null },
    { key: "reads" as const, label: "Reads", count: reads.length },
  ];
  // Opening on a tab that is empty by construction shows a wall of nothing, so the first tab with
  // rows wins — which is Positions again the day positions exist. `?tab=` overrides it, both so a
  // person can link to one and so the design checks can reach the tabs the data does not open on.
  const [tab, setTab] = useState<TabKey>(
    () => openTab ?? tabs.find((one) => one.count !== null && one.count > 0)?.key ?? "positions",
  );

  const body = (
    <>
      <div className={styles.top}>
        {/* The dark block in a light page. It is not a dark-coloured panel: it is the studio's own
            surface appearing inline, so every token inside it resolves to the dark ramp.

            The id is not decoration: surfaces.mjs names this block in MUST_NEST, and a selector
            that had to find it by [data-surface] could not tell "the panel is gone" from "the panel
            lost its surface" — the two failures it most needs to tell apart. */}
        <section id="portfolio-balance" className={styles.total} data-surface="dark">
          <p className={styles.totalLabel}>BALANCE</p>
          <p className={styles.totalFigure} data-unknown={wallet.balance === null}>
            {wallet.balance === null ? "—" : formatBalance(wallet.balance)}{" "}
            <span>{TARGET_CHAIN.nativeCurrency.symbol}</span>
          </p>
          {/* Where the canvas carries a gain since entry. There is no entry and no position to have
              one, and a number here would be the only invented figure on the page. */}
          <p className={styles.totalNote}>
            {wallet.address
              ? `${shortAddress(wallet.address)} · NOT A TOTAL, SEE BELOW`
              : "NO WALLET READ · NOT A TOTAL, SEE BELOW"}
          </p>

          <div className={styles.tiles}>
            <div className={styles.tile}>
              <p className={styles.tileValue}>—</p>
              <p className={styles.tileLabel}>
                <span className={styles.markLime} aria-hidden="true" />
                POSITIONS
              </p>
              <p className={styles.tileSub}>SEE PERPL DASHBOARD</p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileValue}>—</p>
              <p className={styles.tileLabel}>
                <span className={styles.markViolet} aria-hidden="true" />
                BACKED
              </p>
              <p className={styles.tileSub}>HOLDINGS NOT CONNECTED</p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileValue}>{reads.length}</p>
              <p className={styles.tileLabel}>
                <span className={styles.markMuted} aria-hidden="true" />
                READS
              </p>
              <p className={styles.tileSub}>PAID FOR</p>
            </div>
          </div>
        </section>

        <section className={styles.side}>
          <p className={styles.sideLabel}>PAID READS</p>
          <p className={styles.sideFigure}>{reads.length}</p>
          <p className={styles.sideNote}>
            Two clocks per read: delivery, then the market. A read that missed its window is
            refunded and counts neither way.
          </p>
          <dl className={styles.ledger}>
            <div className={styles.ledgerRow}>
              <dt>SPENT ON READS</dt>
              <dd>{formatAmount(spent)} AUSD</dd>
            </div>
            <div className={styles.ledgerRow}>
              <dt>REFUNDED</dt>
              <dd>{formatAmount(refunded)} AUSD</dd>
            </div>
            <div className={styles.ledgerRow}>
              <dt>AWAITING EVALUATION</dt>
              <dd>{awaiting}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="What this wallet holds">
        {tabs.map((one) => (
          <button
            key={one.key}
            type="button"
            role="tab"
            id={`portfolio-tab-${one.key}`}
            aria-selected={tab === one.key}
            aria-controls={`portfolio-panel-${one.key}`}
            className={styles.tab}
            /* The selected tab takes the ink as its ground, which makes it a light-on-dark object
               on a light page — the same inversion the total panel uses, at control size. This page
               is light on every route it has, so the value can be stated rather than derived. */
            data-surface={tab === one.key ? "dark" : undefined}
            onClick={() => setTab(one.key)}
          >
            {one.label} <span className={styles.tabCount}>{one.count}</span>
          </button>
        ))}
      </div>

      {tab === "positions" && (
        <section
          className={styles.blank}
          role="tabpanel"
          id="portfolio-panel-positions"
          aria-labelledby="portfolio-tab-positions"
        >
          <h2 className={styles.blankTitle}>Your Perpl positions</h2>
          <p className={styles.blankLead}>
            View your real Perpl account, positions and exposure in the read-only dashboard.
          </p>
          <ButtonLink as={Link} href="/perpl" variant="secondary" size="sm">
            View Perpl portfolio <Icon name="arrow" size={14} />
          </ButtonLink>
        </section>
      )}

      {tab === "backed" && (
        <section
          className={styles.blank}
          role="tabpanel"
          id="portfolio-panel-backed"
          aria-labelledby="portfolio-tab-backed"
        >
          <h2 className={styles.blankTitle}>Token holdings are not connected here</h2>
          <p className={styles.blankLead}>
            Public agent tokens are available to trade. This page does not read your token balances
            yet. Explore the {agents.length} agents and their confirmed tokens.
          </p>
          <ButtonLink as={Link} href="/agents" variant="secondary" size="sm">
            Explore agents <Icon name="arrow" size={14} />
          </ButtonLink>
        </section>
      )}

      {tab === "reads" && (
        <section
          className={styles.rows}
          role="tabpanel"
          id="portfolio-panel-reads"
          aria-labelledby="portfolio-tab-reads"
        >
          {reads.map((read) => {
            const state = readState(read);
            return (
              <article key={read.id} className={styles.row}>
                <p className={styles.probability}>
                  {formatProbability(read.answer?.probability ?? null)}
                </p>
                <div className={styles.rowBody}>
                  <p className={styles.question}>{read.question}</p>
                  <p className={styles.rowMeta}>
                    {read.agent.name} · {read.market} · ${read.paid} AUSD · {read.when}
                  </p>
                </div>
                <span className={styles.state} data-tone={state.tone}>
                  {state.label}
                </span>
                <Link href={`/reads/${read.id}`} className={styles.open}>
                  Open <Icon name="arrow" size={14} />
                </Link>
              </article>
            );
          })}
          {reads.length === 0 && <p className={styles.blankLead}>No reads on this wallet yet.</p>}
        </section>
      )}
    </>
  );

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>WHAT YOU HOLD.</h1>
      {preview ? (
        <>
          {/* Never in a production build. It says so on the page because a screen that looks
              connected and is not is the worst thing this page could be. */}
          <p className={styles.preview}>
            Design preview · rendered without a wallet so the checks can reach this screen. Every
            figure that needs one reads —.
          </p>
          {body}
        </>
      ) : (
        <ConnectGate
          title="Connect to see your portfolio"
          lead="Pickler reads your balance and your holdings from the address you connect. Nothing is stored."
        >
          {/* A balance read on the wrong chain is a number about the wrong money: the whole page
              waits for the switch rather than showing a dash beside everything. */}
          {wallet.onTargetChain ? body : <WrongNetwork />}
        </ConnectGate>
      )}
    </main>
  );
}

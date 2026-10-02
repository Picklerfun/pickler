"use client";

import type { AgentReadDto, AgentSummaryDto } from "@pickler/api-schema";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink, Icon } from "@pickler/ui";
import { WrongNetwork } from "@/features/status/wrong-network";
import styles from "./portfolio-page.module.css";
import { ConnectGate } from "./connect-gate";
import { ClaimHandle } from "./claim-handle";
import { useWallet } from "../lib/wallet-context";
import { formatBalance, shortAddress, TARGET_CHAIN } from "../lib/provider";
import { formatAmount } from "@/features/markets/lib/format";
import { formatProbability } from "@/features/agents/lib/format";

/**
 * What this wallet holds, and what it has asked for.
 *
 * The canvas (`Portfolio Light.dc.html`) shows three tabs of rows — perp positions, backed agent
 * tokens and paid reads — over a total in AUSD. Only one of those three has a source today:
 *
 *   positions — no endpoint, no DTO, no fixture. Opening one needs testnet contracts this site
 *               cannot sign against, so there is nothing to list and nothing to total.
 *   backed    — the launcher contracts are not deployed, so no wallet holds an agent token. The
 *               board knows each agent's curve; it does not know anyone's holding.
 *   reads     — real, from /marketplace/reads: the question, the probability, the price and both clocks.
 *
 * So the composition is the canvas's and the figures are only the ones that exist. The empty tabs
 * say what is missing rather than showing a plausible row, and the headline is the balance the
 * chain actually reports rather than a total assembled out of two absences.
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
  needsHandle = false,
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
  /**
   * Show the handle panel whatever the wallet says: the design checks reach this screen through
   * `preview`, with no wallet. Otherwise the panel shows for a signed-in account known to have no
   * profile — somebody who closed the chooser at its username step.
   */
  needsHandle?: boolean;
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
  const graduated = agents.filter((agent) => agent.token?.stage === "graduated").length;

  const tabs = [
    { key: "positions" as const, label: "Positions", count: 0 },
    { key: "backed" as const, label: "Backed", count: 0 },
    { key: "reads" as const, label: "Reads", count: reads.length },
  ];
  // Opening on a tab that is empty by construction shows a wall of nothing, so the first tab with
  // rows wins — which is Positions again the day positions exist. `?tab=` overrides it, both so a
  // person can link to one and so the design checks can reach the tabs the data does not open on.
  const [tab, setTab] = useState<TabKey>(
    () => openTab ?? tabs.find((one) => one.count > 0)?.key ?? "positions",
  );

  const body = (
    <>
      {/* Known to have no username: the chooser asked and was closed, or a reload found the
          account's session and read it. Not known is not asked. */}
      {(needsHandle || wallet.hasProfile === false) && <ClaimHandle />}
      <div className={styles.top}>
        {/* The dark block in a light page. It is not a dark-coloured panel: it is the studio's own
            surface appearing inline, so every token inside it resolves to the dark ramp.

            The id is not decoration: surfaces.mjs names this block in MUST_NEST, and a selector
            that had to find it by [data-surface] could not tell "the panel is gone" from "the panel
            lost its surface" — the two failures it most needs to tell apart. */}
        <section id="portfolio-balance" className={styles.total} data-surface="dark">
          <p className={styles.totalLabel}>BALANCE · {TARGET_CHAIN.name.toUpperCase()}</p>
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
              <p className={styles.tileValue}>0</p>
              <p className={styles.tileLabel}>
                <span className={styles.markLime} aria-hidden="true" />
                POSITIONS
              </p>
              <p className={styles.tileSub}>NOT WIRED YET</p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileValue}>0</p>
              <p className={styles.tileLabel}>
                <span className={styles.markViolet} aria-hidden="true" />
                BACKED
              </p>
              <p className={styles.tileSub}>NO TOKEN DEPLOYED</p>
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
          <h2 className={styles.blankTitle}>No positions, and no way to open one yet</h2>
          <p className={styles.blankLead}>
            The perp surface is drawn but nothing behind it settles: opening a position needs the
            testnet contracts and a wallet this site can sign with, and it has neither. This is not
            an empty account — it is a market that has not opened.
          </p>
          <ButtonLink as={Link} href="/markets" variant="secondary" size="sm">
            See the markets <Icon name="arrow" size={14} />
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
          <h2 className={styles.blankTitle}>No agent tokens on-chain to hold</h2>
          <p className={styles.blankLead}>
            The launcher contracts are not deployed, so no wallet holds an agent token — including
            this one. The board knows where each curve stands; {graduated} of {agents.length} agents
            have graduated theirs. It does not know anyone&rsquo;s holding, so nothing is listed
            here rather than a row that looks like a balance.
          </p>
          <ButtonLink as={Link} href="/tokens" variant="secondary" size="sm">
            See the board <Icon name="arrow" size={14} />
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

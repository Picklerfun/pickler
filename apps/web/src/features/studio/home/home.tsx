"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@pickler/ui";
import { SecondPasskey } from "@/features/auth/components/second-passkey";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import { accentVars } from "@/lib/accent";
import { useNow } from "@/lib/now";
import {
  agentRuns,
  errorCode,
  readPaperOrder,
  runEvents,
  studioWallets,
  type Agent,
  type StudioWallets,
  type PaperOrder,
  type Run,
  type RunEvent,
} from "../api";
import { agentInitials } from "../lib/initials";
import { startPolling } from "../lib/polling";
import type { SectionKey } from "../sections/keys";
import { CreditsModal } from "../new-agent/credits-modal";
import { WalletsModal } from "../new-agent/wallets-modal";
import { AgentCard } from "./agent-card";
import { DraftWallet } from "./draft-wallet";
import { GoPublic } from "./go-public";
import { goPublicSteps } from "./go-public-model";
import { HomeMenu } from "./menu";
import { NextUp } from "./next-up";
import { Picks } from "./picks";
import { Schedule } from "./schedule";
import { homeStatus, nextUp, pickCard, stripLog, type OrderState, type Pill } from "./status";
import { Strip } from "./strip";
import { WalletCard } from "./wallet-card";
import shell from "../studio.module.css";
import styles from "./home.module.css";

/** What a preview hands the home instead of the API: a fixed clock, runs, events and an order. */
interface HomePreview {
  now: number;
  runs: Run[];
  events: RunEvent[];
  order: PaperOrder | null;
}

const ACTIVE: Run["status"][] = ["queued", "running"];
const LIVE_POLL_MS = 3000;
/** With the schedule on a new run can start at any time, so the home keeps looking, slowly. */
const SCHEDULED_POLL_MS = 20_000;
const ORDER_POLL_MS = 3000;

const PILL_TINT: Record<Pill, string> = {
  WORKING: "violet",
  "FIRST CALL IN": "lime",
  LIVE: "lime",
  "NO CALL YET": "grey",
};

/**
 * The studio home, after the first run: "Pickler Studio v5" limited to what creating and funding
 * an agent needs (docs/specs/studio-create-and-fund-v1.md §5). Its own top bar, the live strip, and
 * three columns — the agent with its wallet and schedule, its picks, and what to do next. Every
 * other studio section is one Menu click away.
 *
 * It reads the agent's latest run itself: every three seconds while it is queued or running, every
 * twenty while the schedule is on, and not at all once it is terminal. A run that finishes reads
 * the agent again, because its first run is what opens the schedule's first lock.
 */
export function Home({
  agent,
  passkeys,
  agents,
  canManage,
  preview,
  onRefreshAgent,
  onSection,
  onPick,
  onSwitch,
  onNew,
}: {
  agent: Agent;
  /** The shell's one read of the account's passkeys, for the second-passkey suggestion. */
  passkeys: PasskeysKnown;
  agents: Agent[];
  canManage: boolean;
  /** Set for the design preview; nothing is read from or written to the API then. */
  preview: HomePreview | null;
  onRefreshAgent(): Promise<void>;
  onSection(key: SectionKey): void;
  onPick(runId: string): void;
  onSwitch(agentId: string): void;
  /** "+ New agent": open the create screen. */
  onNew(): void;
}) {
  const agentId = agent.productId ?? agent.id;
  const wallClock = useNow();
  const now = preview ? preview.now : wallClock;
  const [runs, setRuns] = useState<Run[]>(preview?.runs ?? []);
  const [trace, setTrace] = useState<{ runId: string; events: RunEvent[] } | null>(
    preview?.runs[0] ? { runId: preview.runs[0].id, events: preview.events } : null,
  );
  const [loaded, setLoaded] = useState(preview !== null);
  const [loadError, setLoadError] = useState("");
  const [order, setOrder] = useState<{ runId: string; state: OrderState } | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  /* "Your wallets" and its "AI credits" tab, opened from its wallet: moves to and from master. */
  const [modal, setModal] = useState<
    null | { kind: "wallets"; toAgent: boolean | null } | { kind: "credits" }
  >(null);
  const [wallets, setWallets] = useState<StudioWallets | null>(null);
  const wasActive = useRef<string | null>(null);
  const refreshAgent = useRef(onRefreshAgent);
  useEffect(() => {
    refreshAgent.current = onRefreshAgent;
  }, [onRefreshAgent]);

  const latest = runs[0] ?? null;
  const events = trace && latest && trace.runId === latest.id ? trace.events : [];

  /* The latest run and its events. One cancellable loop, stopped on unmount or agent change. */
  useEffect(() => {
    if (preview) {
      return;
    }
    return startPolling(
      async (signal) => {
        const list = await agentRuns(agentId, signal);
        if (signal.aborted) {
          return null;
        }
        const newest = list.runs[0] ?? null;
        let body: { events: RunEvent[] } | null = null;
        if (newest) {
          body = await runEvents(newest.id, signal);
          if (signal.aborted) {
            return null;
          }
        }
        setRuns(list.runs);
        setTrace(newest && body ? { runId: newest.id, events: body.events } : null);
        setLoaded(true);
        setLoadError("");
        const active = newest !== null && ACTIVE.includes(newest.status);
        if (active) {
          wasActive.current = newest.id;
        } else if (newest && wasActive.current === newest.id) {
          // It just finished: its first run is what opens the schedule's first lock.
          wasActive.current = null;
          void refreshAgent.current().catch((caught: unknown) => {
            setRefreshError(caught instanceof Error ? caught.message : "Could not read the agent.");
          });
        }
        if (active) {
          return LIVE_POLL_MS;
        }
        return agent.scheduleEnabled ? SCHEDULED_POLL_MS : null;
      },
      (caught) => {
        setLoadError(caught instanceof Error ? caught.message : "Could not read its runs.");
      },
    );
  }, [agentId, preview, agent.scheduleEnabled]);

  /* A TRADE's paper order, read once it is decided, and again while it is still pending. */
  const tradeRunId =
    latest?.status === "completed" && latest.decision?.action === "TRADE" ? latest.id : null;
  useEffect(() => {
    if (preview || !tradeRunId) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const paper = await readPaperOrder(tradeRunId);
        if (!active) {
          return;
        }
        setOrder({ runId: tradeRunId, state: { state: "loaded", order: paper } });
        if (paper.status === "pending") {
          timer = setTimeout(() => void read(), ORDER_POLL_MS);
        }
      } catch (caught) {
        if (!active) {
          return;
        }
        setOrder({
          runId: tradeRunId,
          state:
            errorCode(caught) === "NOT_FOUND"
              ? { state: "missing" }
              : {
                  state: "error",
                  message:
                    caught instanceof Error ? caught.message : "Could not read its paper order.",
                },
        });
      }
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tradeRunId, preview]);

  /* The wallets are read each time the modal opens and after every move; a preview reads none. */
  function readWallets() {
    if (preview) {
      return;
    }
    studioWallets().then(setWallets, (caught: unknown) =>
      setRefreshError(caught instanceof Error ? caught.message : "Could not read your wallets."),
    );
  }

  /** Open "Your wallets"; with a direction, its wallet's move form shows that way. */
  function openWallets(toAgent: boolean | null) {
    setModal({ kind: "wallets", toAgent });
    readWallets();
  }

  let orderState: OrderState;
  if (preview) {
    orderState = preview.order ? { state: "loaded", order: preview.order } : { state: "none" };
  } else if (!tradeRunId) {
    orderState = { state: "none" };
  } else if (order && order.runId === tradeRunId) {
    orderState = order.state;
  } else {
    orderState = { state: "loading" };
  }

  const status = homeStatus({ run: latest, events, agent, now, runCount: runs.length });
  const card = latest ? pickCard({ run: latest, events, order: orderState, now }) : null;
  const calls = runs.filter((run) => run.decision).length;
  const next = nextUp({
    callIn: status.picks === "done" || agent.scheduleEnabled,
    balanceAusd: agent.wallet?.balanceAusd ?? 0,
  });
  const name = agent.name ?? "Your agent";

  async function refresh() {
    setRefreshError("");
    await onRefreshAgent();
  }

  return (
    <main className={styles.home} data-surface="dark">
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
          <span>PICKLER</span>
          <small>TESTNET</small>
        </Link>
        <span className={styles.agentChip}>
          <span className={styles.chipMark} style={accentVars(agent.accent)} aria-hidden="true">
            {agentInitials(name)}
          </span>
          <b>{name}</b>
          {agent.handle && <small>@{agent.handle}</small>}
        </span>
        <span className={styles.pill} data-tint={PILL_TINT[status.pill]}>
          <span className={styles.pillDot} data-live={status.working} />
          {status.pill}
        </span>
        {agent.draft && (
          <span className={styles.pill} data-tint="amber" id="home-draft-chip">
            DRAFT · PRIVATE
          </span>
        )}
        <span className={styles.spacer} />
        <HomeMenu
          agent={agent}
          agents={agents}
          calls={calls}
          running={status.working}
          canManage={canManage}
          onSection={onSection}
          onSwitch={onSwitch}
          onNew={onNew}
        />
        <Link href="/account" className={styles.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>

      {status.strip && latest && <Strip strip={status.strip} log={stripLog(events, latest)} />}

      {preview && (
        <p className={styles.previewNote} role="status">
          <Icon name="alert" size={13} />
          Design preview. This home is drawn from a fixture; nothing on it can be sent or saved.
        </p>
      )}
      {(loadError || refreshError) && (
        <p className={styles.alert} role="alert" data-wide="true">
          <Icon name="alert" size={13} />
          {loadError || refreshError}
        </p>
      )}

      <div className={styles.notice}>
        <SecondPasskey passkeys={passkeys} id="home-second-passkey" />
      </div>

      <div className={styles.board}>
        <div className={styles.column}>
          <AgentCard name={name} accent={agent.accent} status={status} />
          {agent.draft ? (
            <DraftWallet agent={agent} preview={preview !== null} onWallets={openWallets} />
          ) : (
            <>
              <WalletCard
                agent={agent}
                preview={preview !== null}
                canManage={canManage}
                open={depositOpen}
                onOpen={setDepositOpen}
                onRefresh={refresh}
                onPullBack={() => openWallets(false)}
              />
              <Schedule
                agent={agent}
                now={now}
                preview={preview !== null}
                canManage={canManage}
                onRefresh={refresh}
              />
            </>
          )}
        </div>
        {loaded ? (
          <Picks
            status={status}
            card={card}
            runId={latest?.id ?? null}
            calls={calls}
            orderError={orderState.state === "error" ? orderState.message : ""}
            onOpen={onPick}
          />
        ) : (
          <section className={styles.column} id="home-picks" aria-label="Picks" aria-busy="true">
            <div className={styles.colBar}>
              <h2 className={styles.colHead}>Picks</h2>
            </div>
            <p className={styles.empty}>Reading its runs…</p>
          </section>
        )}
        {agent.draft ? (
          <GoPublic steps={goPublicSteps(agent)} onFund={() => openWallets(true)} />
        ) : (
          <NextUp
            items={next.items}
            count={next.count}
            onDeposit={() => {
              setDepositOpen(true);
              document.getElementById("home-wallet")?.scrollIntoView({ block: "center" });
            }}
          />
        )}
      </div>
      <WalletsModal
        open={modal?.kind === "wallets"}
        wallets={wallets}
        openOn={
          modal?.kind === "wallets" && modal.toAgent !== null
            ? (agent.wallet?.walletId ?? null)
            : null
        }
        openToAgent={modal?.kind === "wallets" ? (modal.toAgent ?? true) : true}
        draft={null}
        preview={preview !== null}
        onClose={() => setModal(null)}
        onCredits={() => setModal({ kind: "credits" })}
        onMoved={() => {
          readWallets();
          void refresh().catch((caught: unknown) =>
            setRefreshError(caught instanceof Error ? caught.message : "Could not read the agent."),
          );
        }}
      />
      <CreditsModal
        open={modal?.kind === "credits"}
        onClose={() => setModal(null)}
        onWallets={() => openWallets(null)}
      />
    </main>
  );
}

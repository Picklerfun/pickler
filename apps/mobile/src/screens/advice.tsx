import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { adviceAmount, analysisTime, elapsedLabel, holdsFlow, JOB_ERROR_COPY, REFUSAL_COPY, splitLine } from "../advice/copy";
import type { AdviceResult, AdviceSymbol, Recommendation, StudioAgent } from "../advice/types";
import { EXPLORER_TX_URL, shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import type { AdviceAskState, AskQuote, Settlement } from "../hooks/useAdviceAsk";
import { useNow } from "../hooks/useNow";
import { WalletLockedError } from "../identity/api";
import { Btn, Card, Chip, EmptyPanel, KV, Page, Reveal, Segmented, Skeleton, StatusCard, T, Tag, Touch, TouchCard, Warn, type Tone } from "../ui/primitives";
import { FooterBar, PageScroll } from "../ui/Page";
import { C } from "../ui/theme";
import { describeError } from "../wallet/wallet";

// The advice screen of a Studio agent (plan 2026-10-12-studio-agents-app, Task 4): price, BTC/ETH, the free history, the
// paid Ask with its confirmation in place, the wait, the result and every way it can stop. The Ask itself lives in
// useStudio (App level): this screen only attaches to it, so leaving and coming back finds it where it was.

const TONES = {
  done: { bd: C.limeBd, bg: C.limeBg06, fg: C.limeInk },
  failed: { bd: C.downBd, bg: C.downBg, fg: C.down },
  pending: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
} as const satisfies Record<string, Tone>;

const SYMBOLS: readonly (readonly [AdviceSymbol, string])[] = [["BTC", "BTC"], ["ETH", "ETH"]];

const ORIENTATION: Record<AdviceResult["orientation"], { label: string; fg: string }> = {
  long: { label: "LONG", fg: C.up },
  short: { label: "SHORT", fg: C.down },
  wait: { label: "WAIT", fg: C.warn },
};

type History = { kind: "loading" } | { kind: "locked" } | { kind: "error"; message: string } | { kind: "ready"; items: Recommendation[] };

function TxLink({ settlement }: { settlement: Settlement | null }) {
  if (settlement === null) return null;
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(settlement.transaction)); }} accessibilityLabel="advice-payment-tx">
      <T w={500} s={10.5} lh={1.4} mono color={C.dim}>PAYMENT {shortHash(settlement.transaction)} · MONADSCAN ↗</T>
    </Touch>
  );
}

function Elapsed({ since, prefix }: { since: number; prefix: string }) {
  const now = useNow(1000);
  return <T w={700} s={13} mono color={C.warn}>{prefix} {elapsedLabel(since, now)}</T>;
}

function Bullets({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Tag>{title}</Tag>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          <T w={500} s={14} lh={1.4} color={C.faint}>·</T>
          <T w={400} s={14} lh={1.4} style={{ flex: 1 }}>{item}</T>
        </View>
      ))}
    </View>
  );
}

/** One analysis: orientation, summary, reasons, risks, limitations, sources, data time and (when paid here) the payment. */
function ResultBody({ result, settlement }: { result: AdviceResult; settlement: Settlement | null }) {
  const o = ORIENTATION[result.orientation];
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <T w={700} s={30} lh={1} ls={-0.03} display color={o.fg}>{o.label}</T>
        <T w={500} s={10.5} mono color={C.faint}>{result.symbol} · NEXT 24H</T>
      </View>
      <T w={500} s={16} lh={1.4}>{result.summary}</T>
      <Bullets title="REASONS" items={result.reasons} />
      <Bullets title="RISKS" items={result.risks} />
      <Bullets title="LIMITATIONS" items={result.limitations} />
      {result.sources.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Tag>SOURCES</Tag>
          {result.sources.map((s) => (
            <Touch key={s.id} onPress={() => { void Linking.openURL(s.url); }} accessibilityLabel={`advice-source-${s.id}`}>
              <T w={500} s={13} lh={1.4} color={C.blue}>{s.name} ↗</T>
            </Touch>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.hair12 }}>
        <T w={500} s={10.5} lh={1.4} mono color={C.faint}>DATA AS OF {analysisTime(result.dataAsOf)}</T>
        <TxLink settlement={settlement} />
      </View>
    </View>
  );
}

/** The in-screen confirmation (the WithdrawScreen review pattern): what is paid, to whom, and what is not refunded. */
function Confirmation({ quote }: { quote: AskQuote }) {
  return (
    <Card pad={15} gap={9}>
      <Tag>YOU PAY · AUSD</Tag>
      <T w={700} s={30} lh={1} ls={-0.02} mono>{adviceAmount(quote.total)}</T>
      <View style={{ gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.hair12 }}>
        <KV k="AGENT" v={quote.agent.name} />
        <KV k="SYMBOL" v={`${quote.symbol} · NEXT 24H`} />
        <KV k="SPLIT" v={splitLine(quote.agent.handle)} vFg={C.dim} />
        <KV k="RECIPIENT" v={shortHash(quote.recipient)} vFg={C.dim} />
        <KV k="TOTAL" v={`${adviceAmount(quote.total)} AUSD`} vFg={C.limeInk} />
      </View>
      <T w={600} s={12} lh={1.4} color={C.down}>Not refunded automatically if the analysis fails.</T>
    </Card>
  );
}

/** The body for this agent's Ask, by state. Idle shows nothing: the price card and the history say enough. */
function FlowBody({ state, nav }: { state: AdviceAskState; nav: AppCtx["nav"] }) {
  switch (state.kind) {
    case "quoting":
      return <StatusCard tag="ASKING FOR THE PRICE" title="Checking the payment terms" body="Nothing is signed until you confirm." tone={TONES.pending} />;
    case "confirming":
    case "signing":
    case "paying":
      return <Confirmation quote={state.quote} />;
    case "waiting":
      return (
        <StatusCard
          tag={state.rechecking ? "CHECKING AGAIN · PAID" : "ANALYZING · PAID"}
          title={state.rechecking ? "Checking on your analysis" : "The agent is working on it"}
          body={state.rechecking ? "Still waiting on the same paid analysis. Nothing is paid again." : "You can leave this screen. The analysis keeps going and shows here when it's done."}
          tone={TONES.pending}
          big
        >
          <Elapsed since={state.since} prefix={state.rechecking ? "SINCE YOU PAID" : "ELAPSED"} />
          <TxLink settlement={state.settlement} />
        </StatusCard>
      );
    case "done":
      return state.recommendation.result ? (
        <Card pad={16}>
          <ResultBody result={state.recommendation.result} settlement={state.settlement} />
        </Card>
      ) : (
        <StatusCard tag="DONE" title="The analysis came back empty" tone={TONES.failed} />
      );
    case "failed":
      return (
        <StatusCard tag="ANALYSIS FAILED" title={JOB_ERROR_COPY[state.error]} body="Your payment is marked to be refunded. It is not refunded automatically." tone={TONES.failed}>
          <TxLink settlement={state.settlement} />
        </StatusCard>
      );
    case "timeout":
      return (
        <StatusCard tag="STILL RUNNING" title="Still running — check back" body="No answer after 4 minutes. Pickler is still running it; checking again never pays again." tone={TONES.pending}>
          <TxLink settlement={state.settlement} />
        </StatusCard>
      );
    case "untrusted":
      return <StatusCard tag="NOTHING SIGNED" title="Payment terms changed — nothing was signed" body="Pickler asked for a payment the app does not sign. Nothing left this wallet." tone={TONES.failed} />;
    case "price_changed":
      return (
        <StatusCard tag="PRICE CHANGED · NOTHING SIGNED" title={`The price is now ${adviceAmount(state.price)} AUSD`} body={`It was ${adviceAmount(state.shown)} AUSD when you asked. Ask again at the new price, or cancel.`} tone={TONES.pending} />
      );
    case "refused":
      return (
        <StatusCard tag="PAYMENT REFUSED · NOTHING CHARGED" title={REFUSAL_COPY[state.error]} body="Pickler turned the payment down before settling it. Nothing was charged." tone={TONES.failed}>
          {state.faucet ? <Chip label="Get test AUSD in Wallet" onPress={() => nav("wallet")} style={{ alignSelf: "flex-start" }} accessibilityLabel="advice-faucet" /> : null}
        </StatusCard>
      );
    case "settlement_pending":
      return (
        <StatusCard
          tag={state.checking ? "CHECKING AGAIN…" : "PAYMENT BEING CHECKED"}
          title="Your payment is being checked"
          body="It may still be landing, or it landed and the analysis is not queued yet. Nothing is paid again from here; check again in a minute."
          tone={TONES.pending}
        />
      );
    case "busy":
      return <StatusCard tag="PAID · AGENTS BUSY" title="Your payment went through; the queue is full" body="Try again to start the analysis. You won't pay again." tone={TONES.pending} />;
    case "offline":
      return state.paid
        ? <StatusCard tag="NO ANSWER · PAYMENT SENT" title="Couldn't reach Pickler after paying" body="Try again: the same payment is resent, never a new one." tone={TONES.pending} />
        : <StatusCard tag="NO ANSWER" title="Couldn't reach Pickler" body="Nothing was signed. Check your connection and try again." tone={TONES.failed} />;
    case "signin_error":
      return <StatusCard tag="SIGN-IN FAILED" title="Couldn't sign in to Pickler" body={`Nothing was signed for this analysis. (${state.code})`} tone={TONES.failed} />;
    case "error":
      return <StatusCard tag="SOMETHING WENT WRONG" title={state.message ?? "Couldn't ask this agent"} body={`Nothing was paid. (${state.code})`} tone={TONES.failed} />;
    default:
      return null;
  }
}

/** Advice screen. Gated like the profile; hidden with the whole section unless identity.studioAgents. */
export function AdviceScreen({ S, studio, account, nav }: AppCtx) {
  const { advice } = studio;
  const flowAgent = advice.flow?.agent ?? null;
  // An agent that left the list keeps its own Ask on view: the flow carries the agent it was asked of.
  const agent = studio.agents?.find((a) => a.id === S.adviceAgentId) ?? (flowAgent?.id === S.adviceAgentId ? flowAgent : undefined);
  const mine = flowAgent !== null && flowAgent.id === S.adviceAgentId;
  const [picked, setPicked] = useState<AdviceSymbol>(mine ? advice.flow!.symbol : "BTC");
  const symbol: AdviceSymbol = mine ? advice.flow!.symbol : picked;
  const [hist, setHist] = useState<History>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const request = useRef(0);
  const agentId = agent?.id;
  const { history } = studio;

  const loadHistory = useCallback(async (open: boolean) => {
    if (agentId === undefined) return;
    const id = ++request.current;
    setHist((h) => (h.kind === "ready" && !open ? h : { kind: "loading" }));
    try {
      const page = await history(agentId, symbol, open);
      if (id === request.current) setHist({ kind: "ready", items: page.items });
    } catch (e) {
      if (id !== request.current) return;
      if (e instanceof WalletLockedError || describeError(e) === "") setHist({ kind: "locked" });
      else setHist({ kind: "error", message: "Couldn't load past analyses." });
    }
  }, [agentId, symbol, history]);

  // Read on entering and on each change of agent or symbol; not again when the wallet opens or the token renews.
  const loadRef = useRef(loadHistory);
  loadRef.current = loadHistory;
  useEffect(() => {
    setHist({ kind: "loading" });
    setOpenId(null);
    void loadRef.current(false);
  }, [agentId, symbol]);

  // A finished analysis joins the free history: read it again once this Ask is done.
  const doneHere = mine && advice.state.kind === "done";
  useEffect(() => {
    if (doneHere) void loadRef.current(false);
  }, [doneHere]);

  // "Leave and ask again" asks twice; any change of state takes the question back.
  useEffect(() => { setLeaving(false); }, [advice.state.kind]);

  if (!agent && studio.agents === null && !studio.agentsError) {
    return (
      <PageScroll screen="advice">
        <Page gap={12}>
          <Skeleton.Card lines={3} />
          <Skeleton.Card lines={4} />
        </Page>
      </PageScroll>
    );
  }
  if (!agent) {
    return (
      <PageScroll screen="advice">
        <Page gap={12}>
          {studio.agentsError ? (
            <Warn title="Couldn't load Studio agents" body={studio.agentsError}>
              <Chip label="Retry" onPress={() => { void studio.refresh(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-advice-agent" />
            </Warn>
          ) : (
            <Warn title="This agent isn't listed anymore" />
          )}
        </Page>
      </PageScroll>
    );
  }

  const state = advice.state;
  const elsewhere = flowAgent !== null && !mine && holdsFlow(state) ? flowAgent : null;
  const view: AdviceAskState = mine ? state : { kind: "idle" };
  const price = adviceAmount(agent.price.micro);
  const locked = account?.status === "locked";
  const choose = (k: AdviceSymbol) => {
    if (mine && holdsFlow(state)) return;
    if (mine && state.kind !== "idle") advice.reset();
    setPicked(k);
  };

  return (
    <>
      <PageScroll screen="advice">
        <Page gap={12}>
          <Card pad={16} gap={12}>
            <View style={{ gap: 6 }}>
              <Tag>PRICE · PER ANALYSIS</Tag>
              <T w={700} s={26} lh={1.1} ls={-0.03} mono>{price} AUSD</T>
            </View>
            <T w={400} s={14} lh={1.4} color={C.dim}>A 24-hour outlook — long, short or wait — with its reasons, risks and sources. Paid from this wallet.</T>
            <Segmented options={SYMBOLS} value={symbol} onChange={choose} />
          </Card>

          {elsewhere ? (
            <Warn title="Finish or leave the analysis in progress" body={`Your ${advice.flow!.symbol} analysis with ${elsewhere.name} is still in progress. One paid analysis at a time.`}>
              <Chip label={`Open ${elsewhere.name}`} onPress={() => nav("advice", { adviceAgentId: elsewhere.id })} style={{ alignSelf: "flex-start" }} accessibilityLabel="advice-open-in-progress" />
            </Warn>
          ) : null}

          <FlowBody state={view} nav={nav} />

          <View style={{ gap: 10, marginTop: 6 }}>
            <T w={700} s={22} ls={-0.04} display>PAST ANALYSES</T>
            <T w={500} s={10.5} mono color={C.faint}>{symbol} · FREE TO READ</T>
            {hist.kind === "loading" ? (
              <><Skeleton.Card lines={2} /><Skeleton.Card lines={2} /></>
            ) : hist.kind === "locked" ? (
              <Warn title="Unlock to read past analyses" body="Your wallet signs in to Pickler. No transaction, no gas.">
                <Btn label="Unlock with Face ID" onPress={() => { void loadHistory(true); }} variant="violet" py={11} accessibilityLabel="advice-history-unlock" />
              </Warn>
            ) : hist.kind === "error" ? (
              <Warn title={hist.message}>
                <Chip label="Retry" onPress={() => { void loadHistory(false); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-advice-history" />
              </Warn>
            ) : hist.items.length === 0 ? (
              <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No analyses of {symbol} yet.</T></EmptyPanel>
            ) : (
              <Reveal style={{ gap: 10 }}>
                {hist.items.map((r) => <HistoryRow key={r.id} r={r} open={openId === r.id} onPress={() => setOpenId(openId === r.id ? null : r.id)} />)}
              </Reveal>
            )}
          </View>
        </Page>
      </PageScroll>
      <FooterBar>
        <Footer agent={agent} state={view} elsewhere={elsewhere !== null} price={price} locked={locked} leaving={leaving} setLeaving={setLeaving} symbol={symbol} advice={advice} />
      </FooterBar>
    </>
  );
}

function HistoryRow({ r, open, onPress }: { r: Recommendation; open: boolean; onPress: () => void }) {
  if (r.result === null) return null;
  const o = ORIENTATION[r.result.orientation];
  return (
    <TouchCard onPress={onPress} accessibilityLabel={`advice-history-${r.id}`} radius={16} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <T w={700} s={13} mono color={o.fg}>{o.label}</T>
        <T w={500} s={10.5} mono color={C.faint}>{analysisTime(r.result.generatedAt)}</T>
      </View>
      {open ? <ResultBody result={r.result} settlement={null} /> : <T w={400} s={14} lh={1.4} numberOfLines={2}>{r.result.summary}</T>}
    </TouchCard>
  );
}

type FooterProps = {
  agent: StudioAgent; state: AdviceAskState; elsewhere: boolean; price: string; locked: boolean; leaving: boolean;
  setLeaving: (v: boolean) => void; symbol: AdviceSymbol; advice: AppCtx["studio"]["advice"];
};

/** The sticky action, by state. Leaving a payment being checked, a job still running or an unanswered payment asks once more. */
function Footer({ agent, state, elsewhere, price, locked, leaving, setLeaving, symbol, advice }: FooterProps) {
  const leave = (
    <Btn label="Leave and ask again" onPress={() => setLeaving(true)} variant="ghost" py={10} s={13} accessibilityLabel="advice-leave" />
  );
  if (leaving) {
    return (
      <>
        <T w={500} s={12} lh={1.4} color={C.warn}>The first payment may still land and be charged. A new analysis is a new payment. Leave anyway?</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Stay" onPress={() => setLeaving(false)} variant="outline2" flex={1} py={14} accessibilityLabel="advice-stay" />
          <Btn label="Leave" onPress={() => { void advice.abandon(); }} variant="ink" flex={1} py={14} accessibilityLabel="advice-leave-confirm" />
        </View>
      </>
    );
  }
  switch (state.kind) {
    case "confirming":
    case "signing":
    case "paying": {
      const busy = state.kind !== "confirming";
      return (
        <>
          {locked && !busy ? <T w={400} s={11.5} lh={1.4} color={C.faint}>Face ID unlocks the wallet to sign this payment.</T> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn label="Cancel" onPress={advice.reset} variant="outline2" disabled={busy} style={{ minWidth: 104 }} py={14} accessibilityLabel="advice-cancel" />
            <Btn
              label={state.kind === "signing" ? "Signing…" : state.kind === "paying" ? "Paying…" : `Pay ${adviceAmount(state.quote.total)} AUSD`}
              icon={locked && !busy ? "faceId" : undefined}
              onPress={() => { void advice.confirm(); }}
              variant="lime"
              flex={1}
              busy={busy}
              s={13.5}
              py={14}
              accessibilityLabel="advice-pay"
            />
          </View>
        </>
      );
    }
    case "quoting":
      return <Btn label="Asking…" variant="ask" busy py={14} accessibilityLabel="advice-asking" />;
    case "waiting":
      return <ActivityIndicator color={C.warn} />;
    case "timeout":
      return (
        <>
          <Btn label="Check again" onPress={() => { void advice.refresh(); }} variant="lime" py={14} accessibilityLabel="advice-check-again" />
          {leave}
        </>
      );
    case "settlement_pending":
      return (
        <>
          <Btn label={state.checking ? "Checking…" : "Check again"} onPress={() => { void advice.checkAgain(); }} variant="lime" busy={state.checking} py={14} accessibilityLabel="advice-check-again" />
          {state.checking ? null : leave}
        </>
      );
    case "busy":
      return <Btn label={state.retrying ? "Trying…" : "Try again"} onPress={() => { void advice.retry(); }} variant="lime" busy={state.retrying} py={14} accessibilityLabel="advice-retry" />;
    case "offline":
      return state.paid ? (
        <>
          <Btn label="Try again" onPress={() => { void advice.retry(); }} variant="lime" py={14} accessibilityLabel="advice-retry" />
          {leave}
        </>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Cancel" onPress={advice.reset} variant="outline2" style={{ minWidth: 104 }} py={14} accessibilityLabel="advice-cancel" />
          <Btn label="Try again" onPress={() => { void advice.retry(); }} variant="lime" flex={1} py={14} accessibilityLabel="advice-retry" />
        </View>
      );
    case "price_changed":
      return (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Cancel" onPress={advice.reset} variant="outline2" style={{ minWidth: 104 }} py={14} accessibilityLabel="advice-cancel" />
          <Btn label={`Ask at ${adviceAmount(state.price)} AUSD`} onPress={() => { void advice.acceptPrice(); }} variant="ask" flex={1} py={14} accessibilityLabel="advice-accept-price" />
        </View>
      );
    case "done":
    case "failed":
    case "refused":
    case "untrusted":
    case "signin_error":
    case "error":
      return <Btn label="Done" onPress={advice.reset} variant="outline2" py={14} accessibilityLabel="advice-done" />;
    default:
      return (
        <Btn
          label={`Ask · ${price} AUSD`}
          icon="ask"
          variant="ask"
          disabled={elsewhere}
          onPress={() => { void advice.ask(agent, symbol); }}
          py={14}
          accessibilityLabel="advice-ask"
        />
      );
  }
}

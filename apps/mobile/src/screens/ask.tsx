import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import type { Reads } from "../hooks/useReads";
import type { Market } from "../perpl/context";
import { formatPrice } from "../perpl/orders";
import {
  callOf, type Cell, cellLabel, expiresAtFor, formatProbability, formatRemaining, HORIZONS_MIN, horizonLabel, LEVELS_BPS, levelLabel, questionFor, targetFor,
} from "../reads/matrix";
import type { Agent, Read, ReadStatus } from "../reads/types";
import type { AskCell } from "../store";
import { Btn, Card, Chip, Segmented, StatusCard, T, Tag, type Tone, Touch, TouchCard, Warn } from "../ui/primitives";
import { C, pill } from "../ui/theme";

/** Tick de 30 s para las cuentas regresivas de toda la pantalla (P14). */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

/** Tonos de D14: OPEN warn · RIGHT up · WRONG down · VOID/FAILED/PENDING faint. */
const STATUS: Record<ReadStatus, { label: string; fg: string; bd: string }> = {
  pending: { label: "READING", fg: C.faint, bd: C.hair18 },
  open: { label: "OPEN", fg: C.warn, bd: C.warnBd },
  right: { label: "RIGHT", fg: C.up, bd: C.limeBd },
  wrong: { label: "WRONG", fg: C.down, bd: C.downBd },
  void: { label: "VOID", fg: C.faint, bd: C.hair18 },
  failed: { label: "FAILED", fg: C.faint, bd: C.hair18 },
};
const READING: Tone = { bd: C.warnBd, bg: C.warnBg, fg: C.warn };
const FAILED: Tone = { bd: C.downBd, bg: C.downBg, fg: C.down };
const ASK: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime };

const agentName = (agents: Agent[] | null, id: string): string => agents?.find((a) => a.id === id)?.name ?? id;

/** Línea de estado bajo la card: cuenta regresiva o resultado. */
function resolutionLine(read: Read, now: number): { text: string; fg: string } {
  const pd = read.priceDecimals;
  switch (read.status) {
    case "open": return { text: `Resolves in ${formatRemaining(Date.parse(read.expiresAt) - now)}`, fg: C.dim };
    case "right": return { text: `Right · resolved at ${formatPrice(read.markAtResolution ?? 0, pd)}`, fg: C.up };
    case "wrong": return { text: `Wrong · resolved at ${formatPrice(read.markAtResolution ?? 0, pd)}`, fg: C.down };
    case "void": return { text: "Voided — Perpl was unavailable at expiry. Credit refunded.", fg: C.faint };
    case "failed": return { text: "Failed — credit refunded.", fg: C.faint };
    case "pending": return { text: "Still reading…", fg: C.faint };
  }
}

export function ReadCard({ read, agentName: name, now, pushOff, footer }: { read: Read; agentName: string; now: number; pushOff?: boolean; footer?: ReactNode }) {
  const p = read.probability;
  const yes = p !== null && callOf(p);
  const line = resolutionLine(read, now);
  return (
    <Card bd={C.hair2} bg={C.deep} gap={9}>
      <Tag color={C.faint}>{read.symbol} {cellLabel(read)} · {name.toUpperCase()}</Tag>
      <T w={400} s={12} lh={1.4} color={C.dim}>{read.question}</T>
      {p !== null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T w={700} s={30} lh={1.1} ls={-0.02} display>{formatProbability(p)}</T>
          <Chip label={yes ? "YES" : "NO"} mono s={10} fg={yes ? C.lime : C.down} bd={yes ? C.limeBd : C.downBd} accessibilityLabel={`call-${yes ? "yes" : "no"}`} />
          <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>probability of yes · mark {formatPrice(read.markAtRequest, read.priceDecimals)} at request</T>
        </View>
      ) : null}
      {read.reasons ? (
        <View style={{ gap: 4 }}>
          <Tag>REASONS</Tag>
          {read.reasons.map((r, i) => <T key={i} w={400} s={12} lh={1.45} color={C.ink}>· {r}</T>)}
        </View>
      ) : null}
      {read.limits ? (
        <View style={{ gap: 4 }}>
          <Tag>WHAT WOULD BREAK IT</Tag>
          <T w={400} s={12} lh={1.45} color={C.dim}>{read.limits}</T>
        </View>
      ) : null}
      <T w={500} s={11} lh={1.3} mono color={line.fg}>{line.text}</T>
      {pushOff && read.status === "open" ? <T w={400} s={11} lh={1.4} color={C.faint}>Push is off — check My reads to see the result.</T> : null}
      {footer}
    </Card>
  );
}

function SessionGate({ reads }: { reads: Reads }) {
  const signing = reads.session === "signing";
  return (
    <StatusCard tag="ASK" title="Unlock to ask" body="Your wallet signs once a day to use its simulated credits. No transaction, no gas." tone={ASK}>
      <Btn label={signing ? "Unlocking…" : "Unlock with Face ID"} onPress={() => { void reads.ensureSession(); }} variant="lime" busy={signing} accessibilityLabel="ask-unlock" />
      {reads.sessionError ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{reads.sessionError}</T> : null}
    </StatusCard>
  );
}

function CreditsRow({ credits }: { credits: number | null }) {
  return (
    <Card bd={C.hair14} bg={C.card} pad={11} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Tag>CREDITS</Tag>
      <T w={700} s={16} lh={1} mono>{credits === null ? "—" : String(credits)}</T>
      <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>1 credit per read · simulated for the testnet</T>
    </Card>
  );
}

function MatrixGrid({ market, selected, onSelect }: { market: Market; selected?: AskCell; onSelect: (c: Cell) => void }) {
  return (
    <Card bd={C.hair14} bg={C.card} pad={10} gap={5}>
      <T w={400} s={11} lh={1.3} color={C.faint}>Mark {formatPrice(market.mark, market.priceDecimals)} · updates every 5 s</T>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <View style={{ width: 46 }} />
        {HORIZONS_MIN.map((h) => <Tag key={h} style={{ flex: 1, textAlign: "center" }}>{horizonLabel(h)}</Tag>)}
      </View>
      {LEVELS_BPS.map((bps) => (
        <View key={bps} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <T w={500} s={10} lh={1} mono color={bps > 0 ? C.up : C.down} style={{ width: 46 }}>{levelLabel(bps)}</T>
          {HORIZONS_MIN.map((h) => {
            const on = selected?.levelBps === bps && selected?.horizonMin === h;
            const p = pill(on);
            return (
              <Touch key={h} onPress={() => onSelect({ levelBps: bps, horizonMin: h })} accessibilityLabel={`cell-${bps}-${h}`}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg, alignItems: "center" }}>
                <T w={500} s={9.5} lh={1} mono color={p.fg}>{formatPrice(targetFor(market.mark, bps), market.priceDecimals)}</T>
              </Touch>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function AskSheet({ market, cell, reads, agentId, onAgent, onAsk }: { market: Market; cell: AskCell; reads: Reads; agentId: string | undefined; onAgent: (id: string) => void; onAsk: (agentId: string) => void }) {
  const target = targetFor(market.mark, cell.levelBps);
  const question = questionFor(market.symbol, cell.levelBps, target, market.priceDecimals, expiresAtFor(new Date(), cell.horizonMin));
  const agent = reads.agents?.find((a) => a.id === agentId) ?? reads.agents?.[0];
  const noCredits = reads.credits !== null && reads.credits <= 0;
  return (
    <Card bd={C.limeBd} bg={C.limeBg06} gap={9}>
      <Tag color={C.lime}>{market.symbol} {cellLabel(cell)} · TARGET {formatPrice(target, market.priceDecimals)}</Tag>
      <T w={700} s={16} lh={1.25} ls={-0.01} display>{question}</T>
      {reads.agents === null ? <T w={400} s={11.5} color={C.faint}>{reads.agentsError || "Loading agents…"}</T> : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {reads.agents.map((a) => {
            const on = a.id === agent?.id;
            const p = pill(on);
            return <Chip key={a.id} label={`${a.name} · by ${a.owner} · ${a.priceCredits} credit`} onPress={() => onAgent(a.id)} fg={p.fg} bd={p.bd} bg={p.bg} s={10.5} accessibilityLabel={`agent-${a.id}`} />;
          })}
        </View>
      )}
      <Btn label={noCredits ? "No credits left" : agent ? `Ask ${agent.name} · ${agent.priceCredits} credit` : "Ask"} onPress={() => { if (agent) onAsk(agent.id); }} variant="lime" py={14} disabled={noCredits || !agent} accessibilityLabel="ask" />
      {noCredits ? <T w={400} s={11} lh={1.4} color={C.faint}>Credits are simulated for the testnet.</T> : null}
    </Card>
  );
}

function ReadRow({ read, name, now, onPress }: { read: Read; name: string; now: number; onPress: () => void }) {
  const st = STATUS[read.status];
  const line = resolutionLine(read, now);
  return (
    <TouchCard onPress={onPress} accessibilityLabel={`read-${read.id}`} style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T w={700} s={12.5} lh={1} mono style={{ flex: 1 }}>{cellLabel(read)}</T>
        {read.probability !== null ? <T w={500} s={12} lh={1} mono color={C.dim}>{formatProbability(read.probability)}</T> : null}
        <Chip label={st.label} mono s={9.5} py={5} px={8} fg={st.fg} bd={st.bd} />
      </View>
      <T w={400} s={11} lh={1.3} color={C.faint}>{name} · {line.text}</T>
    </TouchCard>
  );
}

export function AskTab(ctx: AppCtx) {
  const { S, set, perpl, reads, notifications } = ctx;
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId)!; // MarketScreen ya comprobó que existe
  const now = useNow(30_000);
  const pushOff = notifications.permission === "denied" || notifications.permission === "unavailable";
  const focused = useMemo(() => (S.askFocusReadId ? reads.reads.find((r) => r.id === S.askFocusReadId) : undefined), [S.askFocusReadId, reads.reads]);

  const newRead = () => {
    if (reads.session !== "ready") return <SessionGate reads={reads} />;
    const { request } = reads;
    if (request.step === "pending") {
      return <StatusCard tag="READING" title="Reading… up to 60 s" body={`${agentName(reads.agents, request.agentId)} is looking at ${market.symbol} ${cellLabel(request.cell)}.`} tone={READING}><ActivityIndicator color={C.warn} style={{ alignSelf: "flex-start" }} /></StatusCard>;
    }
    if (request.step === "failed") {
      return (
        <View style={{ gap: 11 }}>
          <StatusCard tag="FAILED" title="No read this time" body={request.text} tone={FAILED} />
          <Btn label="Try again" onPress={reads.resetRequest} variant="ghost" accessibilityLabel="ask-retry" />
        </View>
      );
    }
    if (request.step === "done") {
      return (
        <ReadCard read={request.read} agentName={agentName(reads.agents, request.read.agentId)} now={now} pushOff={pushOff}
          footer={<Btn label="Ask another" onPress={() => { reads.resetRequest(); set({ askCell: undefined }); }} variant="ghost" accessibilityLabel="ask-another" />} />
      );
    }
    return (
      <View style={{ gap: 11 }}>
        <CreditsRow credits={reads.credits} />
        <MatrixGrid market={market} selected={S.askCell} onSelect={(c) => set({ askCell: c })} />
        {S.askCell ? (
          <AskSheet market={market} cell={S.askCell} reads={reads} agentId={S.askAgentId} onAgent={(id) => set({ askAgentId: id })}
            onAsk={(id) => { void reads.ask(S.askCell!, id); }} />
        ) : <T w={400} s={11} lh={1.4} color={C.faint}>Tap a cell: level above or below the mark × horizon.</T>}
        {reads.listError ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
      </View>
    );
  };

  const myReads = () => {
    if (reads.session !== "ready") return <SessionGate reads={reads} />;
    if (focused) {
      return (
        <ReadCard read={focused} agentName={agentName(reads.agents, focused.agentId)} now={now} pushOff={pushOff}
          footer={<Btn label="Back to list" onPress={() => set({ askFocusReadId: undefined })} variant="ghost" accessibilityLabel="read-back" />} />
      );
    }
    return (
      <View style={{ gap: 7 }}>
        {reads.listError ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
        {reads.reads.length === 0 ? <T w={400} s={12} lh={1.4} color={C.faint}>No reads on {market.symbol} yet.</T> : null}
        {reads.reads.map((r) => <ReadRow key={r.id} read={r} name={agentName(reads.agents, r.agentId)} now={now} onPress={() => set({ askFocusReadId: r.id })} />)}
      </View>
    );
  };

  return (
    <View style={{ paddingTop: 13, paddingHorizontal: 15, paddingBottom: 20, gap: 11 }}>
      <Segmented options={[["new", "New read"], ["mine", "My reads"]] as const} value={S.askView} onChange={(k) => set({ askView: k, askFocusReadId: undefined })} />
      {S.askView === "new" ? newRead() : myReads()}
    </View>
  );
}

import { type ReactNode, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import type { Reads } from "../hooks/useReads";
import type { Market } from "../perpl/context";
import { sparkPoints } from "../perpl/marks";
import { formatPrice } from "../perpl/orders";
import {
  callOf, type Cell, cellLabel, distanceLabel, dotKey, expiresAtFor, formatProbability, formatRemaining, HORIZONS_MIN, horizonLabel, LEVELS_BPS,
  levelLabel, questionFor, readDots, readsForMarket, stepHorizon, stepLevel, targetFor,
} from "../reads/matrix";
import { levelFromCell, levelFromRead, sideFor } from "../reads/level";
import type { Agent, Read } from "../reads/types";
import type { AskCell, TradeLevel } from "../store";
import { Btn, Card, Chip, Reveal, Skeleton, Sparkline, StatusCard, Stepper, T, Tag, type Tone, Touch, Warn } from "../ui/primitives";
import { C, GRID_ACCENT, GRID_DOT } from "../ui/theme";

const READING: Tone = { bd: C.warnBd, bg: C.warnBg, fg: C.warn };
const FAILED: Tone = { bd: C.downBd, bg: C.downBg, fg: C.down };
const ASK: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.limeInk };

const agentName = (agents: Agent[] | null, id: string): string => agents?.find((a) => a.id === id)?.name ?? id;

/** Línea de estado bajo la card: cuenta regresiva o resultado. */
export function resolutionLine(read: Read, now: number): { text: string; fg: string } {
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
    <Card gap={9}>
      <Tag color={C.faint}>{read.symbol} {cellLabel(read)} · {name.toUpperCase()}</Tag>
      <T w={400} s={12} lh={1.4} color={C.dim}>{read.question}</T>
      {p !== null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T w={700} s={40} lh={1.1} ls={-0.02} mono color={C.vio}>{formatProbability(p)}</T>
          <Chip label={yes ? "YES" : "NO"} mono s={10} fg={yes ? C.limeInk : C.down} bg={yes ? C.limeBg14 : C.downBg} bd={yes ? C.limeBg14 : C.downBg} accessibilityLabel={`call-${yes ? "yes" : "no"}`} />
          <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>probability of yes · mark {formatPrice(read.markAtRequest, read.priceDecimals)} at request</T>
        </View>
      ) : null}
      {read.reasons ? (
        <View style={{ gap: 4 }}>
          <Tag>WHY</Tag>
          {read.reasons.map((r, i) => <T key={i} w={400} s={12} lh={1.45} color={C.ink}>· {r}</T>)}
        </View>
      ) : null}
      {read.limits ? (
        <View style={{ gap: 4, padding: 12, borderRadius: 14, backgroundColor: C.warnBg }}>
          <Tag color={C.warn}>LIMITS</Tag>
          <T w={400} s={12} lh={1.45} color={C.dim}>{read.limits}</T>
        </View>
      ) : null}
      <T w={500} s={11} lh={1.3} mono color={line.fg}>{line.text}</T>
      {pushOff && read.status === "open" ? <T w={400} s={11} lh={1.4} color={C.faint}>Push is off — check Portfolio → Reads to see the result.</T> : null}
      {footer}
    </Card>
  );
}

function SessionGate({ reads }: { reads: Reads }) {
  const signing = reads.session === "signing";
  return (
    <StatusCard tag="ASK" title="Unlock to ask" body="Your wallet signs once a day to use its simulated credits. No transaction, no gas." tone={ASK}>
      <Btn label={signing ? "Unlocking…" : "Unlock with Face ID"} onPress={() => { void reads.ensureSession(); }} variant="violet" busy={signing} accessibilityLabel="ask-unlock" />
      {reads.sessionError ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{reads.sessionError}</T> : null}
    </StatusCard>
  );
}

/** D2 sin excepciones: skeleton sólo sin dato Y sin error; con error, «—» (I3, revisión final F1). */
function CreditsRow({ credits, error }: { credits: number | null; error: string }) {
  return (
    <Card pad={11} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Tag>CREDITS</Tag>
      {credits === null && !error ? <Skeleton h={16} w={28} r={4} />
        : credits === null ? <T w={700} s={16} lh={1} mono>—</T>
        : <Reveal><T w={700} s={16} lh={1} mono>{String(credits)}</T></Reveal>}
      <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>1 credit per read · simulated for the testnet</T>
    </Card>
  );
}

/** El `Grid` del prototipo: sparkline a la izquierda, escalera de precios, celdas de 48 px con un punto donde ya hay reads, horizontes abajo. */
function MatrixGrid({ market, marks, dots, selected, onSelect }: { market: Market; marks: readonly number[]; dots: Set<string>; selected?: AskCell; onSelect: (c: Cell) => void }) {
  const acc = GRID_ACCENT.ask;
  const pd = market.priceDecimals;
  return (
    <View style={{ borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.card, overflow: "hidden" }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 74, borderRightWidth: 1, borderRightColor: C.hair10 }}>
          <Sparkline points={sparkPoints(marks)} style={StyleSheet.absoluteFill} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {LEVELS_BPS.map((bps, i) => {
            const rowOn = selected?.levelBps === bps;
            const markBand = bps > 0 && (LEVELS_BPS[i + 1] ?? 0) < 0; // la banda del mark va entre el último nivel positivo y el primero negativo (P4)
            return (
              <View key={bps}>
                <View style={{ flexDirection: "row", borderBottomWidth: markBand ? 0 : 1, borderBottomColor: C.hair08 }}>
                  <View style={{ width: 58, justifyContent: "center", paddingLeft: 7, gap: 3, borderRightWidth: 1, borderRightColor: C.hair08 }}>
                    <T w={500} s={9.5} lh={1} mono color={bps > 0 ? C.up : C.down} numberOfLines={1}>{formatPrice(targetFor(market.mark, bps), pd)}</T>
                    <T w={500} s={8.5} lh={1} mono color={C.faint} numberOfLines={1}>{levelLabel(bps)}</T>
                  </View>
                  {HORIZONS_MIN.map((h) => {
                    const colOn = selected?.horizonMin === h;
                    const on = rowOn && colOn;
                    return (
                      <Touch key={h} onPress={() => onSelect({ levelBps: bps, horizonMin: h })} accessibilityLabel={`cell-${bps}-${h}`}
                        style={{ flex: 1, minWidth: 0, height: 48, borderLeftWidth: 1, borderLeftColor: C.hair08, backgroundColor: on ? acc.on : rowOn || colOn ? acc.soft : "transparent", alignItems: "center", justifyContent: "center" }}>
                        <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dots.has(dotKey({ levelBps: bps, horizonMin: h })) ? GRID_DOT : "transparent" }} />
                      </Touch>
                    );
                  })}
                </View>
                {markBand ? (
                  <View style={{ height: 22, justifyContent: "center", paddingLeft: 7, backgroundColor: C.ink }} accessibilityLabel="mark-band">
                    <T w={700} s={10.5} lh={1} mono color={C.onInk} numberOfLines={1}>{formatPrice(market.mark, pd)} MARK</T>
                  </View>
                ) : null}
              </View>
            );
          })}
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 58 }} />
            {HORIZONS_MIN.map((h) => (
              <View key={h} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}>
                <T w={500} s={9.5} lh={1} mono color={selected?.horizonMin === h ? acc.fg : C.faint}>{horizonLabel(h)}</T>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/** La hoja de la celda del prototipo (ConsultTab): chip del agente + Change, pregunta, distancia, steppers, Ask/Clear. */
function AskSheet({ market, cell, reads, agentId, onAgent, onCell, onClear, onAsk, onTrade }: {
  market: Market; cell: AskCell; reads: Reads; agentId: string | undefined;
  onAgent: (id: string) => void; onCell: (c: AskCell) => void; onClear: () => void; onAsk: (agentId: string) => void; onTrade: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const pd = market.priceDecimals;
  const target = targetFor(market.mark, cell.levelBps);
  const question = questionFor(market.symbol, cell.levelBps, target, pd, expiresAtFor(new Date(), cell.horizonMin));
  const agent = reads.agents?.find((a) => a.id === agentId) ?? reads.agents?.[0]; // el agente mostrado es el que se cobra (D14)
  const noCredits = reads.credits !== null && reads.credits <= 0;
  const price = `${agent?.priceCredits ?? 1} credit`;
  return (
    <Card bg={C.vioBg06} bd="transparent" gap={9}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Chip label={`Asking ${agent?.name ?? "…"} · ${price}`} fg={C.vio} bd={C.vioBg} bg={C.vioBg} s={10.5} py={5} px={9} style={{ flexShrink: 1 }} />
        <Touch onPress={() => setPicking((p) => !p)} style={{ paddingVertical: 5, paddingHorizontal: 8 }} accessibilityLabel="ask-change">
          <T w={600} s={10.5} lh={1} color={C.faint}>{picking ? "Done" : "Change"}</T>
        </Touch>
      </View>
      {reads.agents === null ? (
        reads.agentsError
          ? <T w={400} s={11.5} color={C.faint}>{reads.agentsError}</T>
          : <View style={{ flexDirection: "row", gap: 6 }}><Skeleton h={28} w={118} r={999} /><Skeleton h={28} w={96} r={999} /><Skeleton h={28} w={104} r={999} /></View>
      ) : picking ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {reads.agents.map((a) => {
            const on = a.id === agent?.id;
            return (
              <Chip key={a.id} label={`${a.name} · by ${a.owner} · ${a.priceCredits} credit`} onPress={() => { onAgent(a.id); setPicking(false); }}
                fg={on ? C.vio : C.dim} bd={on ? C.vioBd : C.hair18} bg={on ? C.vioBg : "transparent"} s={10.5} accessibilityLabel={`agent-${a.id}`} />
            );
          })}
        </View>
      ) : null}
      <Tag color={C.vio}>YOUR QUESTION · NOTHING SENT</Tag>
      <T w={700} s={14} lh={1.3} ls={-0.01}>{question}</T>
      <T w={500} s={10} lh={1.4} mono color={C.faint}>RESOLVES ON PERPL MARK · {distanceLabel(cell.levelBps)}</T>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Stepper value={formatPrice(target, pd)} accessibilityLabel="step-level"
          onDown={() => onCell({ levelBps: stepLevel(cell.levelBps, -1), horizonMin: cell.horizonMin })}
          onUp={() => onCell({ levelBps: stepLevel(cell.levelBps, 1), horizonMin: cell.horizonMin })} />
        <Stepper value={horizonLabel(cell.horizonMin)} width={118} accessibilityLabel="step-horizon"
          onDown={() => onCell({ levelBps: cell.levelBps, horizonMin: stepHorizon(cell.horizonMin, -1) })}
          onUp={() => onCell({ levelBps: cell.levelBps, horizonMin: stepHorizon(cell.horizonMin, 1) })} />
      </View>
      <View style={{ flexDirection: "row", gap: 7 }}>
        <Btn label={noCredits ? "No credits left" : `Ask ${agent?.name ?? "agent"} · ${price}`} onPress={() => { if (agent) onAsk(agent.id); }}
          arrow flex={1} py={12} variant="violet" disabled={noCredits || !agent} accessibilityLabel="ask" />
        <Btn label="Clear" onPress={onClear} variant="ghost" py={12} accessibilityLabel="ask-clear" />
      </View>
      <Btn label="Trade this level" onPress={onTrade} variant="lime" py={11} accessibilityLabel="trade-level" />
      <T w={400} s={10.5} lh={1.4} color={C.faint}>{noCredits ? "Credits are simulated for the testnet." : "Nothing charged yet."}</T>
    </Card>
  );
}

export function AskTab(ctx: AppCtx) {
  const { S, set, perpl, reads, notifications } = ctx;
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId)!; // MarketScreen ya comprobó que existe
  const now = useNow(30_000);
  const pushOff = notifications.permission === "denied" || notifications.permission === "unavailable";

  // D12: el nivel al store, lado sugerido y pill Trade. El resultado/lista de Ask se conservan (volver atrás no pierde nada).
  const tradeLevel = (level: TradeLevel) => set({ tradeLevel: level, perpsSide: sideFor(level.levelBps), marketTab: "trade" });

  const cardFooter = (read: Read, ghost: ReactNode) => (
    <View style={{ flexDirection: "row", gap: 7 }}>
      {read.status === "open" ? <Btn label="Trade this level" onPress={() => tradeLevel(levelFromRead(read))} variant="lime" flex={1} py={11} accessibilityLabel="trade-level" /> : null}
      {ghost}
    </View>
  );

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
          footer={cardFooter(request.read, <Btn label="Ask another" onPress={() => { reads.resetRequest(); set({ askCell: undefined }); }} variant="ghost" py={11} accessibilityLabel="ask-another" />)} />
      );
    }
    const dots = readDots(readsForMarket(reads.reads, market.id));
    return (
      <View style={{ gap: 11 }}>
        <CreditsRow credits={reads.credits} error={reads.listError} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Tag s={10}>HISTORY · MARK</Tag>
          <T w={700} s={15} lh={1} mono>{formatPrice(market.mark, market.priceDecimals)}</T>
        </View>
        <MatrixGrid market={market} marks={perpl.marks[market.id] ?? []} dots={dots} selected={S.askCell} onSelect={(c) => set({ askCell: c })} />
        <T w={400} s={11.5} lh={1.45} color={C.faint}>{S.askCell ? "Use the steppers to move it." : "Tap a cell: a level and a horizon."}</T>
        {S.askCell ? (
          <AskSheet market={market} cell={S.askCell} reads={reads} agentId={S.askAgentId}
            onAgent={(id) => set({ askAgentId: id })} onCell={(c) => set({ askCell: c })} onClear={() => set({ askCell: undefined })}
            onAsk={(id) => { void reads.ask(S.askCell!, id); }} onTrade={() => tradeLevel(levelFromCell(market, S.askCell!, new Date()))} />
        ) : null}
        <Card gap={7}>
          <Tag>MARK PRICE · PERPL ON MONAD</Tag>
          <T w={400} s={11.5} lh={1.45} color={C.dim}>Reads resolve on mark, not on your fill.</T>
        </Card>
        {reads.listError ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
      </View>
    );
  };

  return (
    <View style={{ paddingTop: 13, paddingHorizontal: 15, paddingBottom: 20, gap: 11 }}>
      {newRead()}
    </View>
  );
}

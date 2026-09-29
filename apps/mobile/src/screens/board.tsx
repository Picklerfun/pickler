// Board nivel × tiempo del Handoff (spec mobile-light D10–D12): banda MARK, celdas de 48 px con puntos de
// reads, trayectoria de precio al fondo y punto "now". Reemplaza a MatrixGrid en Trade it y Ask an agent.
import { View } from "react-native";
import Svg, { Polygon, Polyline } from "react-native-svg";
import type { Market } from "../perpl/context";
import { formatPrice } from "../perpl/orders";
import { BOARD_CELL_H, BOARD_H, BOARD_MARK_H, boardCaption, boardRows, type BoardMode, cellTone, trajectory } from "../reads/board";
import { type Cell, dotKey, HORIZONS_MIN, horizonLabel } from "../reads/matrix";
import { Card, T, Tag, Touch } from "../ui/primitives";
import { C } from "../ui/theme";

const CAPTION_FG: Record<"long" | "short" | "ask" | "none", string> = { long: C.limeInk, short: C.down, ask: C.vio, none: C.faint };
const TINT: Record<"long" | "short" | "ask", string> = { long: C.limeBg, short: C.downBg, ask: C.vioBg };
const PILL: Record<"long" | "short" | "ask", { bg: string; fg: string; label: string }> = {
  long: { bg: C.lime, fg: C.ink, label: "LONG" },
  short: { bg: C.short, fg: C.onInk, label: "SHORT" },
  ask: { bg: C.vio, fg: C.onInk, label: "ASK" },
};

function Pill({ tone }: { tone: "long" | "short" | "ask" }) {
  const p = PILL[tone];
  return (
    <View style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: p.bg }}>
      <T w={600} s={9.5} lh={1} ls={0.06} mono color={p.fg}>{p.label}</T>
    </View>
  );
}

/** Capa de trayectoria detrás de las filas: área + línea sobre los marks en memoria, punto "now" al final. */
function Trajectory({ marks, mark }: { marks: readonly number[]; mark: number }) {
  const pts = trajectory(marks, mark);
  if (pts.length === 0) return null;
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${line} 100,100 0,100`;
  const nowY = pts[pts.length - 1][1];
  return (
    <View style={{ position: "absolute", left: 84, right: 0, top: 0, height: BOARD_H }} pointerEvents="none">
      <Svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        <Polygon points={area} fill="rgba(91,60,224,0.07)" />
        <Polyline points={line} stroke={C.spark} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />
      </Svg>
      <View style={{ position: "absolute", right: 2, top: (nowY / 100) * BOARD_H - 4.5, width: 9, height: 9, borderRadius: 999, backgroundColor: C.vio, borderWidth: 2, borderColor: C.bg }} />
    </View>
  );
}

export function Board({ mode, market, marks, dots, selected, onSelect }: {
  mode: BoardMode; market: Market; marks: readonly number[]; dots: Set<string>; selected?: Cell; onSelect: (c: Cell) => void;
}) {
  const pd = market.priceDecimals;
  const rows = boardRows(market.mark);
  const caption = boardCaption(mode, selected, market.mark, pd);
  return (
    <View style={{ gap: 8 }}>
      <Card radius={20} bg={C.card} pad={0}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16 }}>
          <Tag s={10}>LEVEL × TIME</Tag>
          <T w={500} s={10} lh={1} ls={0.06} mono color={CAPTION_FG[caption.tone]}>{caption.text}</T>
        </View>
        <View style={{ marginHorizontal: 6, marginBottom: 6, borderRadius: 14, backgroundColor: C.bg, overflow: "hidden" }}>
          <Trajectory marks={marks} mark={market.mark} />
          {rows.map((row) => {
            if (row.kind === "mark") {
              return (
                <View key="mark" style={{ height: BOARD_MARK_H, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, backgroundColor: C.ink }} accessibilityLabel="mark-band">
                  <T w={700} s={10.5} lh={1} mono color={C.onInk}>{formatPrice(market.mark, pd)}</T>
                  <T w={500} s={9} lh={1} ls={0.12} mono color={C.onInkDim}>MARK</T>
                </View>
              );
            }
            const tone = cellTone(mode, row.bps);
            return (
              <View key={row.bps} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.hair06 }}>
                <View style={{ width: 84, paddingLeft: 12, gap: 3, justifyContent: "center" }}>
                  <T w={700} s={12} lh={1} ls={-0.03} mono color={row.side === "long" ? C.limeInk : C.down}>{formatPrice(row.price, pd)}</T>
                  <T w={500} s={9} lh={1} mono color={C.faint}>{row.label}</T>
                </View>
                {HORIZONS_MIN.map((h) => {
                  const cell = { levelBps: row.bps, horizonMin: h } as Cell;
                  const isSel = selected?.levelBps === row.bps && selected?.horizonMin === h;
                  return (
                    <Touch key={h} onPress={() => onSelect(cell)} accessibilityLabel={`cell-${row.bps}-${h}`}
                      style={{ flex: 1, height: BOARD_CELL_H, alignItems: "center", justifyContent: "center", backgroundColor: isSel ? TINT[tone] : "transparent" }}>
                      {isSel ? <Pill tone={tone} /> : (
                        <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: dots.has(dotKey(cell)) ? C.agentDot : C.empty }} />
                      )}
                    </Touch>
                  );
                })}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", marginHorizontal: 6 }}>
          <View style={{ width: 84, paddingLeft: 12, justifyContent: "center" }}>
            <T w={500} s={9} lh={1} ls={0.1} mono color={C.faint}>TIME</T>
          </View>
          {HORIZONS_MIN.map((h) => (
            <View key={h} style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}>
              <T w={700} s={11} lh={1} mono color={selected?.horizonMin === h ? C.ink : C.dim}>{horizonLabel(h)}</T>
            </View>
          ))}
        </View>
      </Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: C.agentDot }} />
        {/* El Handoff dice "AN AGENT HAS A CALL HERE": los puntos son tus reads, no las de un agente (D10). */}
        <T w={500} s={10} lh={1} ls={0.06} mono color={C.dim}>YOU ASKED AN AGENT HERE</T>
      </View>
    </View>
  );
}

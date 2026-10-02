// Board nivel × tiempo del Handoff (spec mobile-light D10–D12): banda MARK, celdas de 48 px con puntos de
// reads, trayectoria de precio al fondo y punto "now". Reemplaza a MatrixGrid en Trade it y Ask an agent.
import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
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

/** Capa de trayectoria encima de las filas y de la banda MARK: línea sobre los marks en memoria, punto "now" al
 *  final. Va pintada DESPUÉS del grid (ruling del coordinador, item 1 de la ola final): un `View` `position: "absolute"`
 *  no sube de plano solo por ser absoluto, así que si se pinta antes que las filas, éstas (que no son absolutas) la tapan.
 *  Sin polígono de área (ruling visual-fixes #1): tiñe de lavanda todas las filas bajo la línea y parece una selección. */
function Trajectory({ marks, mark }: { marks: readonly number[]; mark: number }) {
  const pts = trajectory(marks, mark);
  if (pts.length === 0) return null;
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const nowY = pts[pts.length - 1][1];
  return (
    <View style={{ position: "absolute", left: 84, right: 0, top: 0, height: BOARD_H }} pointerEvents="none">
      <Svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        <Polyline points={line} stroke={C.spark} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />
      </Svg>
      <View style={{ position: "absolute", right: 2, top: (nowY / 100) * BOARD_H - 4.5, width: 9, height: 9, borderRadius: 999, backgroundColor: C.vio, borderWidth: 2, borderColor: C.bg }} />
    </View>
  );
}

/** Rótulo de la banda MARK repintado por encima de la capa de trayectoria (ruling visual-fixes #2): sin esto, la
 *  línea de `Trajectory` (pintada después del grid) cruza «2659.41 MARK» porque el rótulo es más ancho que la
 *  columna de 84. Mismo fondo `C.ink` de la banda con `paddingRight` extra para tapar la línea bajo el texto; a la
 *  derecha del rótulo (ancho intrínseco, sin `right`) la línea sigue visible. */
function MarkLabel({ top, mark, pd }: { top: number; mark: number; pd: number }) {
  return (
    <View
      style={{ position: "absolute", left: 0, top, height: BOARD_MARK_H, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 20, gap: 8, backgroundColor: C.ink }}
      pointerEvents="none"
    >
      <T w={700} s={10.5} lh={1} mono color={C.onInk}>{formatPrice(mark, pd)}</T>
      <T w={500} s={9} lh={1} ls={0.12} mono color={C.onInkDim}>MARK</T>
    </View>
  );
}

export function Board({ mode, market, marks, dots, selected, target, onSelect }: {
  mode: BoardMode; market: Market; marks: readonly number[]; dots: Set<string>; selected?: Cell; target?: number; onSelect: (c: Cell) => void;
}) {
  const pd = market.priceDecimals;
  const rows = boardRows(market.mark);
  // `target`: en Trade, el precio ya fijado por el nivel (item 2 de la ola final); sin él, `boardCaption` lo recalcula del mark vivo.
  const caption = boardCaption(mode, selected ? { ...selected, target } : undefined, market.mark, pd);
  return (
    <View style={{ gap: 8 }}>
      <Card radius={20} bg={C.card} pad={0}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16 }}>
          <Tag s={10}>LEVEL × TIME</Tag>
          <T w={500} s={10} lh={1} ls={0.06} mono color={CAPTION_FG[caption.tone]}>{caption.text}</T>
        </View>
        <View style={{ marginHorizontal: 6, marginBottom: 6, borderRadius: 14, backgroundColor: C.bg, overflow: "hidden" }}>
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
                    // La fila (`View` de arriba) no fija su alto: lo toma del hijo más alto más su borde inferior de 1.
                    // Con la celda a BOARD_CELL_H (48) completos, la fila mediría 49 y el grid 5×49+26 ≠ BOARD_H (item 3
                    // de la ola final). La celda mide BOARD_CELL_H − 1 para que el borde complete los 48 reales.
                    <Touch key={h} onPress={() => onSelect(cell)} accessibilityLabel={`cell-${row.bps}-${h}`}
                      style={{ flex: 1, height: BOARD_CELL_H - 1, alignItems: "center", justifyContent: "center", backgroundColor: isSel ? TINT[tone] : "transparent" }}>
                      {isSel ? <Pill tone={tone} /> : (
                        <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: dots.has(dotKey(cell)) ? C.agentDot : C.empty }} />
                      )}
                    </Touch>
                  );
                })}
              </View>
            );
          })}
          <Trajectory marks={marks} mark={market.mark} />
          <MarkLabel top={rows.findIndex((r) => r.kind === "mark") * BOARD_CELL_H} mark={market.mark} pd={pd} />
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

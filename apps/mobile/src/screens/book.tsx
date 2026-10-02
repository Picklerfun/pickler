import { useMemo, useState } from "react";
import { View } from "react-native";
import type { MarketData } from "../hooks/useMarketData";
import { BOOK_DEPTH } from "../perpl/config";
import type { Market } from "../perpl/context";
import { type BookLevel, spreadBps, targetPosition, topLevels } from "../perpl/marketData";
import { formatPrice, formatSize } from "../perpl/orders";
import { Bar, Card, Icon, Skeleton, T, Tag, Touch } from "../ui/primitives";
import { C } from "../ui/theme";

const STATUS_LABEL: Record<MarketData["status"], string> = { idle: "", connecting: "CONNECTING", live: "LIVE", reconnecting: "RECONNECTING", closed: "OFFLINE" };
const POSITION_COPY = { above: "above the book", inside: "inside the book", below: "below the book" } as const;

function Row({ level, max, side, pd, sd }: { level: BookLevel; max: number; side: "bid" | "ask"; pd: number; sd: number }) {
  const fg = side === "bid" ? C.up : C.down;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLabel={`${side}-${level.p}`}>
      <T w={500} s={11} lh={1.2} mono color={fg} style={{ width: 84 }}>{formatPrice(level.p, pd)}</T>
      <Bar pct={max > 0 ? level.s / max : 0} h={4} color={side === "bid" ? C.limeBd : C.downBd} />
      <T w={400} s={10.5} lh={1.2} mono color={C.dim} style={{ width: 76, textAlign: "right" }}>{formatSize(level.s, sd)}</T>
    </View>
  );
}

/** Order book L2 (D11), plegado por defecto: 5 asks (el mejor pegado al spread), spread en bps, 5 bids; línea del target si hay nivel (P2), visible también plegada para quien llega desde Ask sin abrir el book. */
export function BookCard({ market, data, target }: { market: Market; data: MarketData; target?: number }) {
  const { book } = data;
  const pd = market.priceDecimals, sd = market.sizeDecimals;
  // topLevels/spreadBps/targetPosition ordenan el lado completo en cada llamada: memoizado por book/target (nota de revisión de Task 6).
  const { asks, bids, max, spread, pos } = useMemo(() => {
    const asks = book ? topLevels(book, "ask").reverse() : [];
    const bids = book ? topLevels(book, "bid") : [];
    const max = Math.max(0, ...asks.map((l) => l.s), ...bids.map((l) => l.s));
    const spread = book ? spreadBps(book) : null;
    const pos = book && target !== undefined ? targetPosition(book, target) : null;
    return { asks, bids, max, spread, pos };
  }, [book, target]);
  const [open, setOpen] = useState(false);
  const live = data.status === "live";
  return (
    <Card gap={7}>
      <Touch onPress={() => setOpen((o) => !o)} accessibilityLabel="book-toggle" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Tag>ORDER BOOK · L2 · {BOOK_DEPTH} PER SIDE</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Tag color={live ? C.limeInk : data.rejected || data.status === "closed" ? C.faint : C.warn}>{STATUS_LABEL[data.status]}</Tag>
          <Icon name={open ? "up" : "down"} size={14} color={C.faint} />
        </View>
      </Touch>
      {target !== undefined ? (
        <T w={500} s={10.5} lh={1.4} mono color={C.limeInk} accessibilityLabel="book-target">Target {formatPrice(target, pd)} · {pos === null ? "book not loaded" : POSITION_COPY[pos]}</T>
      ) : null}
      {!open ? null : book === null ? (
        <View style={{ gap: 6 }}>{Array.from({ length: 4 }, (_, i) => <Skeleton.Line key={i} s={11} w="100%" />)}</View>
      ) : (
        <View style={{ gap: 4 }} accessibilityLabel="book">
          {asks.map((l) => <Row key={`a${l.p}`} level={l} max={max} side="ask" pd={pd} sd={sd} />)}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.hair12 }}>
            <T w={500} s={10} lh={1.2} mono color={C.faint}>SPREAD</T>
            <T w={500} s={10} lh={1.2} mono color={C.dim} accessibilityLabel="spread">{spread === null ? "—" : `${spread.toFixed(1)} bps`}</T>
          </View>
          {bids.map((l) => <Row key={`b${l.p}`} level={l} max={max} side="bid" pd={pd} sd={sd} />)}
        </View>
      )}
      {open && data.rejected ? <T w={400} s={11} lh={1.4} color={C.faint}>Perpl doesn't publish a book for this market right now.</T> : null}
    </Card>
  );
}

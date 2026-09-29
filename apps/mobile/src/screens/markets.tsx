import { useState } from "react";
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import type { Market } from "../perpl/context";
import { filterMarkets } from "../perpl/filter";
import { sparkPoints } from "../perpl/marks";
import { change24h, formatPrice } from "../perpl/orders";
import { Btn, Chip, Page, Reveal, SearchBox, Skeleton, Sparkline, T, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";

// Markets del Handoff (spec mobile-light D7/D9): búsqueda y tarjetas. El gate de trading y las posiciones viven en tradingGate.tsx.
export function MarketsScreen({ perpl, reads, nav }: AppCtx) {
  const [query, setQuery] = useState("");
  const markets = filterMarkets(perpl.context?.markets ?? [], query);
  const agents = reads.agents?.length;
  return (
    <Page gap={12}>
      <SearchBox value={query} onChange={setQuery} placeholder="Search a market" accessibilityLabel="search-markets" />
      {perpl.contextError ? (
        <Warn title="Couldn't load markets" body={perpl.contextError}>
          <Chip label="Retry" onPress={() => { void perpl.refreshContext(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-markets" />
        </Warn>
      ) : null}
      {perpl.context === null && !perpl.contextError ? <>{Array.from({ length: 4 }, (_, i) => <Skeleton.Card key={i} lines={3} />)}</> : null}
      {perpl.context !== null && markets.length === 0 ? <T w={400} s={13} color={C.faint}>No market matches “{query.trim()}”.</T> : null}
      {perpl.context !== null ? (
        <Reveal style={{ gap: 10 }}>
          {markets.map((m) => <MarketCard key={m.id} m={m} marks={perpl.marks[m.id] ?? []} agents={agents}
            onTrade={() => nav("market", { perpsMarketId: m.id, perpsSide: "long", marketTab: "trade" })}
            onAsk={() => nav("market", { perpsMarketId: m.id, marketTab: "ask" })} />)}
        </Reveal>
      ) : null}
    </Page>
  );
}

function MarketCard({ m, marks, agents, onTrade, onAsk }: { m: Market; marks: readonly number[]; agents: number | undefined; onTrade: () => void; onAsk: () => void }) {
  const chg = change24h(m.mark, m.prev);
  const up = chg >= 0;
  return (
    <TouchCard onPress={onTrade} accessibilityLabel={`market-${m.symbol}`} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: up ? C.blueBg : C.downBg, alignItems: "center", justifyContent: "center" }}>
          <T w={700} s={10.5} mono color={up ? C.blue : C.down}>{m.symbol.slice(0, 4)}</T>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w={600} s={18} lh={1.15}>{m.symbol}-PERP</T>
          <T w={500} s={10} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>MAX {m.maxLeverage}× · {agents ?? "—"} AGENTS</T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T w={700} s={17} lh={1} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
          <T w={500} s={10.5} lh={1} mono color={up ? C.up : C.down} style={{ marginTop: 5 }}>{up ? "+" : ""}{(chg * 100).toFixed(1)}%</T>
        </View>
      </View>
      <View style={{ height: 46, borderRadius: 12, backgroundColor: C.bg, overflow: "hidden" }}>
        <Sparkline points={sparkPoints(marks)} stroke={up ? C.up : C.down} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Ask" icon="ask" onPress={onAsk} variant="ask" flex={1} py={12} accessibilityLabel={`ask-${m.symbol}`} />
        <Btn label="Trade" arrow onPress={onTrade} variant="lime" flex={1} py={12} accessibilityLabel={`trade-${m.symbol}`} />
      </View>
    </TouchCard>
  );
}

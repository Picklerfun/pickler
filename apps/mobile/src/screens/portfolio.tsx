import { useState } from "react";
import { View } from "react-native";
import { formatAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import { formatPnl, lockedCollateral, unrealisedPnl } from "../perpl/orders";
import { portfolioTotals } from "../perpl/portfolio";
import { cellLabel, formatProbability, formatRemaining } from "../reads/matrix";
import type { Read, ReadStatus } from "../reads/types";
import { askMarketId } from "../store";
import { Btn, Card, EmptyPanel, InkBlock, InkTile, Page, Reveal, Segmented, Skeleton, T, Tag, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";
import { PositionsPanel, TradingWarns } from "./tradingGate";

type Tab = "positions" | "reads" | "backed";

const READ_TAG: Record<ReadStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: "READING", fg: C.faint, bg: C.ctl },
  open: { label: "IN WINDOW", fg: C.warn, bg: C.warnBg },
  right: { label: "RIGHT", fg: C.limeInk, bg: C.limeBg14 },
  wrong: { label: "WRONG", fg: C.down, bg: C.downBg },
  void: { label: "VOID", fg: C.faint, bg: C.ctl },
  failed: { label: "FAILED", fg: C.faint, bg: C.ctl },
};

function Totals({ perpl }: Pick<AppCtx, "perpl">) {
  const acc = perpl.live?.account ?? null;
  const positions = perpl.live?.positions ?? [];
  const b = acc?.b ?? perpl.lastBalance ?? null;
  const upnl = unrealisedPnl(positions, perpl.context?.markets ?? []);
  const waiting = perpl.state.status === "ready" || perpl.state.status === "loading";
  const t = b === null ? null : portfolioTotals({ b, lb: acc?.lb ?? 0n, locked: lockedCollateral(positions), upnl });
  const tile = (k: string, v: string, fg: string) => (
    <InkTile><Tag color={C.onInkDim}>{k}</Tag><T w={700} s={15} mono color={fg} style={{ marginTop: 6 }}>{v}</T></InkTile>
  );
  return (
    <InkBlock gap={12}>
      <Tag color={C.onInkDim}>TOTAL VALUE · AUSD{acc ? "" : b !== null ? " · LAST SEEN" : ""}</Tag>
      {/* Sin key (ni último saldo) no llega ningún dato: «—» en vez de un skeleton que nunca se resuelve. */}
      {t !== null ? <T w={700} s={44} lh={1} ls={-0.03} mono color={C.onInk}>{formatAusd(t.total)}</T>
        : waiting ? <Skeleton h={44} w="60%" />
        : <T w={700} s={44} lh={1} ls={-0.03} mono color={C.onInkDim}>—</T>}
      {upnl !== null ? <T w={500} s={11} mono color={upnl <= -10_000n ? C.downOnInk : C.limeOnInk}>{formatPnl(upnl)} AUSD UNREALISED</T> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {tile("POSITIONS", t ? formatAusd(t.positions) : "—", C.limeOnInk)}
        {tile("AVAILABLE", t ? formatAusd(t.available) : "—", C.onInkSoft)}
        {tile("BACKED", "—", C.vioOnInk)}
      </View>
      {t && t.inOrders > 0n ? <T w={400} s={11.5} color={C.onInkDim}>{formatAusd(t.inOrders)} AUSD held by open orders.</T> : null}
    </InkBlock>
  );
}

function ReadRow({ read, name, now, onPress }: { read: Read; name: string; now: number; onPress: () => void }) {
  const tag = READ_TAG[read.status];
  return (
    <TouchCard onPress={onPress} accessibilityLabel={`read-${read.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <T w={700} s={26} mono color={C.vio} style={{ width: 70 }}>{read.probability === null ? "—" : formatProbability(read.probability)}</T>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <T w={600} s={14} lh={1.3} numberOfLines={2}>{read.symbol} {cellLabel(read)}</T>
        <T w={500} s={10} lh={1} mono color={C.faint}>{name.toUpperCase()} · {read.creditsCharged} CREDIT{read.status === "open" ? ` · ${formatRemaining(Date.parse(read.expiresAt) - now).toUpperCase()}` : ""}</T>
      </View>
      <View style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: tag.bg }}><Tag color={tag.fg} s={9.5}>{tag.label}</Tag></View>
    </TouchCard>
  );
}

/** Portfolio (D17): TOTAL, Positions (Perpl, con Close), Reads (tus reads) y Backed (coming soon, se integra con Launchpad). */
export function PortfolioScreen(ctx: AppCtx) {
  const { perpl, reads, nav } = ctx;
  const [tab, setTab] = useState<Tab>("positions");
  const now = useNow(30_000);
  const name = (id: string) => reads.agents?.find((a) => a.id === id)?.name ?? id;
  return (
    <Page gap={14}>
      <Totals perpl={perpl} />
      <Segmented options={[["positions", "Positions"], ["reads", "Reads"], ["backed", "Backed"]] as const} value={tab} onChange={setTab} />
      {tab === "positions" ? (
        perpl.state.status === "ready" ? <View style={{ gap: 10 }}><TradingWarns perpl={perpl} /><PositionsPanel {...ctx} /></View>
        : perpl.state.status === "loading" ? <Skeleton.Card lines={3} />
        : (
          // Sin key, Portfolio no corre Enable: la card manda a Market → Trade, donde vive Enable/Reconnect (D7, D17).
          <Card gap={10}>
            <T w={600} s={16}>Trading not enabled</T>
            <T w={400} s={13.5} lh={1.45} color={C.dim}>Positions live on Perpl. Enable or reconnect trading from a market's Trade tab.</T>
            <Btn label="Open a market" arrow variant="lime" py={12} onPress={() => nav("market", { marketTab: "trade", perpsMarketId: askMarketId(ctx.S.perpsMarketId, perpl.context?.markets ?? []) })} accessibilityLabel="portfolio-enable" />
          </Card>
        )
      ) : tab === "reads" ? (
        reads.session !== "ready" ? (
          <Warn title="Unlock to see your reads" body="Your wallet signs once a day for Ask. No transaction, no gas.">
            <Btn label="Unlock with Face ID" onPress={() => { void reads.ensureSession(); }} variant="violet" py={11} accessibilityLabel="reads-unlock" />
          </Warn>
        ) : reads.reads === null ? <><Skeleton.Card lines={2} /><Skeleton.Card lines={2} /></>
        : reads.reads.length === 0 ? <Reveal><EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No reads yet. Ask an agent from any market.</T></EmptyPanel></Reveal>
        : <Reveal style={{ gap: 10 }}>{reads.reads.map((r) => <ReadRow key={r.id} read={r} name={name(r.agentId)} now={now} onPress={() => nav("read", { readId: r.id })} />)}</Reveal>
      ) : (
        <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>Backing agents comes with Launchpad.</T></EmptyPanel>
      )}
      {reads.listError && tab === "reads" ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
    </Page>
  );
}

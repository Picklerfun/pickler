import { useEffect, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import { change24h, formatPrice, formatSize, leveragesFor, liquidationPrice, notionalAusd, type Side, sizeFromAusd, takerFee } from "../perpl/orders";
import { levelIsLive, levelTitle, reminderKinds, remindersCopy, resolvesLabel, sideFor } from "../reads/level";
import { cellLabel } from "../reads/matrix";
import { askMarketId, type TradeLevel } from "../store";
import { Btn, Card, Chip, InkBlock, KVList, type KVRow, Page, Segmented, Skeleton, T, Tag } from "../ui/primitives";
import { C, pill, textStyle } from "../ui/theme";
import { AskTab } from "./ask";
import { BookCard } from "./book";
import { OrderResultCard, type OrderResult } from "./orderResult";
import { EnableTrading, TradingWarns } from "./tradingGate";

type Step = { step: "edit" } | { step: "review" } | { step: "result"; result: OrderResult };

/** Nivel elegido en Ask (D12): target, vencimiento, lado sugerido y qué pasará tras la orden. Nada cierra la posición. */
function LevelCard({ symbol, level, pd, now, onRemove }: { symbol: string; level: TradeLevel; pd: number; now: number; onRemove: () => void }) {
  const side = sideFor(level.levelBps);
  const two = reminderKinds(level, now).length === 2;
  return (
    <Card bg={C.limeBg} bd="transparent" gap={8}>
      <Tag color={C.limeInk}>TRADE THIS LEVEL · FROM ASK</Tag>
      <T w={700} s={16} lh={1.2} ls={-0.01} display accessibilityLabel="level-title">{levelTitle(symbol, level)} → {formatPrice(level.target, pd)}</T>
      <KVList rows={[
        { label: "TARGET", value: formatPrice(level.target, pd) },
        { label: "RESOLVES", value: resolvesLabel(level, now).replace("Resolves ", "") },
        { label: "SUGGESTED", value: side.toUpperCase(), fg: side === "long" ? C.limeInk : C.down },
      ]} top />
      <T w={400} s={11} lh={1.45} color={C.dim}>{`Once your order fills: a reminder ${two ? "15 min before and one at expiry" : "at expiry"}. Nothing closes the position for you — close it from Portfolio.`}</T>
      <Btn label="Remove level" onPress={onRemove} variant="ghost" py={8} accessibilityLabel="level-remove" />
    </Card>
  );
}

function TradeTab(ctx: AppCtx) {
  const { S, set, perpl, reads, marketData, nav } = ctx;
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId)!; // MarketScreen ya comprobó que existe
  const side: Side = S.perpsSide ?? "long";
  const free = perpl.live?.account ? perpl.live.account.b - perpl.live.account.lb : 0n;
  const [amount, setAmount] = useState("");
  const [lv, setLv] = useState(1);
  const [st, setSt] = useState<Step>({ step: "edit" });
  const now = useNow(30_000);
  // Sólo el nivel de este mercado y todavía vivo; uno de otro mercado se conserva en el store pero no se pinta ni programa nada.
  const level = S.tradeLevel && S.tradeLevel.marketId === market.id && levelIsLive(S.tradeLevel, now) ? S.tradeLevel : undefined;

  if (perpl.state.status === "loading") return <Page top={13}><ActivityIndicator color={C.faint} /></Page>;
  if (perpl.state.status !== "ready") return <EnableTrading {...ctx} />;

  const leverages = leveragesFor(market);
  const lvUsed = leverages.includes(lv) ? lv : 1;
  const units = parseAusd(amount);
  const size = units === undefined ? 0 : sizeFromAusd(units, lvUsed, market.mark, market.priceDecimals, market.sizeDecimals);
  const notional = notionalAusd(size, market.mark, market.priceDecimals, market.sizeDecimals);
  const fee = takerFee(notional, market.takerFeeMicros);
  const liq = liquidationPrice(market.mark, lvUsed, side, market.maintenanceBps, market.maxLeverage);
  // El exchange cobra la fee además del margen: units + fee debe caber en el saldo libre.
  const error = amount === "" ? "" : units === undefined || units === 0n ? "Enter an amount above zero." : units > free ? `That is more than the ${formatAusd(free)} AUSD free.` : size <= 0 ? "That amount is below one unit of this market." : units + fee > free ? `That leaves no room for the ${formatAusd(fee, 4)} AUSD fee.` : "";
  const ok = units !== undefined && units > 0n && units + fee <= free && size > 0;
  // Max deja sitio a la fee: fee(free × lv) acota la fee real (nominal ≤ Max × lv < free × lv), así que Max pasa la validación.
  const maxFee = takerFee(free * BigInt(lvUsed), market.takerFeeMicros);
  const max = free > maxFee ? free - maxFee : 0n;
  const live = perpl.live?.status === "live";
  const sym = market.symbol;

  const confirm = async () => {
    setSt({ step: "result", result: { step: "sent" } });
    const outcome = await perpl.open(market, side, units ?? 0n, lvUsed);
    const result: OrderResult =
      outcome.kind === "filled" ? { step: "filled", title: `Filled ${formatSize(outcome.order.fs, market.sizeDecimals)} ${sym} at ${formatPrice(outcome.order.fp, market.priceDecimals)}`, detail: `Fee ${formatAusd(outcome.order.f, 4)} AUSD · ${side.toUpperCase()} ${lvUsed}x` }
      : outcome.kind === "open" ? { step: "filled", title: "Placed — waiting in the book", detail: `${formatSize(outcome.order.os, market.sizeDecimals)} ${sym}` }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" };
    setSt({ step: "result", result });
    // D12 / P7: con nivel vivo y orden filled u open, recordatorios; primero se muestra la orden, la nota llega después.
    if (result.step === "filled" && level) {
      const r = await reads.setReminders(sym, level, side);
      setSt({ step: "result", result: { ...result, note: r.ok ? remindersCopy(r.kinds) : `Couldn't set reminders — ${r.text}` } });
      if (r.ok) set({ tradeLevel: undefined }); // el nivel se consumió: vive en mobile.reminders
    }
  };

  const rows: KVRow[] = [
    { label: "SIZE", value: `${formatSize(size, market.sizeDecimals)} ${sym} · ≈ ${formatAusd(notional)} AUSD` },
    { label: "EST. PRICE", value: formatPrice(market.mark, market.priceDecimals) },
    { label: "FEE · TAKER", value: `≈ ${formatAusd(fee, 4)} AUSD`, fg: C.dim },
    { label: "LIQUIDATION ≈", value: formatPrice(liq, market.priceDecimals), fg: C.down },
    ...(level ? [{ label: "LEVEL", value: `${cellLabel(level)} → ${formatPrice(level.target, market.priceDecimals)}`, fg: C.limeInk }] : []),
  ];

  if (st.step === "result") {
    return <Page top={13}><OrderResultCard result={st.result} primary={{ label: "See it in Portfolio", onPress: () => nav("portfolio"), accessibilityLabel: "see-in-portfolio" }} onEdit={() => setSt({ step: "edit" })} /></Page>;
  }

  if (st.step === "review") {
    return (
      <Page top={13} gap={11}>
        <InkBlock gap={8}>
          <Tag color={C.onInkDim}>YOU OPEN · {side.toUpperCase()} {sym} · {lvUsed}X · MARKET</Tag>
          <T w={700} s={22} lh={1.1} ls={-0.02} mono color={C.onInk}>{formatAusd(units ?? 0n)} AUSD</T>
          {/* Sobre ink, dim/limeInk/down no se leen: se re-mapean a sus variantes claras. */}
          <KVList rows={rows.map((r) => ({ ...r, fg: r.fg === C.down ? C.downOnInk : r.fg === C.limeInk ? C.limeOnInk : C.onInk }))} kFg={C.onInkDim} top style={{ borderTopColor: C.tile }} />
        </InkBlock>
        {lvUsed > 1 ? <T w={400} s={11.5} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
        <Btn label={live ? `Confirm ${side}` : "Connecting…"} onPress={() => { void confirm(); }} variant="lime" py={14} disabled={!live} accessibilityLabel="confirm" />
        <Btn label="Change amount" onPress={() => setSt({ step: "edit" })} variant="ghost" accessibilityLabel="change-amount" />
        <T w={400} s={11} lh={1.45} color={C.faint}>Market order with up to {market.maxSlippageBps / 100}% slippage. Forwarded orders pay no gas.</T>
      </Page>
    );
  }

  return (
    <Page top={13} gap={11}>
      <TradingWarns perpl={perpl} />
      {level ? <LevelCard symbol={sym} level={level} pd={market.priceDecimals} now={now} onRemove={() => set({ tradeLevel: undefined })} /> : null}
      <Segmented
        options={[["long", "Long · up"], ["short", "Short · down"]] as const}
        value={side}
        onChange={(k) => set({ perpsSide: k })}
        tone={(k) => ({ bg: k === "long" ? C.lime : C.short, fg: C.ink })}
      />
      <BookCard market={market} data={marketData} target={level?.target} />
      <Card gap={6}>
        <Tag>MARGIN · AUSD</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.faint} keyboardType="decimal-pad" accessibilityLabel="margin-input"
            style={[textStyle(700, 32, { lh: 1.3, mono: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]}
          />
          <Chip label="Max" onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} bd={C.hair22} fg={C.ink} accessibilityLabel="max" />
        </View>
        <T w={400} s={11.5} lh={1.4} color={C.dim}>{formatAusd(free)} AUSD free in trading</T>
      </Card>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {leverages.map((l) => {
          const p = pill(l === lvUsed);
          return <Chip key={l} label={`${l}×`} mono s={10} py={8} px={0} style={{ flex: 1 }} fg={p.fg} bd={p.bd} bg={p.bg} onPress={() => setLv(l)} accessibilityLabel={`lv-${l}`} />;
        })}
      </View>
      {leverages.length < 4 ? <T w={400} s={11} lh={1.4} color={C.faint}>{sym} allows up to {market.maxLeverage}x.</T> : null}
      <Card><KVList rows={rows} /></Card>
      {lvUsed > 1 ? <T w={400} s={11.5} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
      {error ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{error}</T> : null}
      <Btn
        label={ok ? (level ? `${side === "long" ? "Long" : "Short"} to ${formatPrice(level.target, market.priceDecimals)} · Review ${formatAusd(units ?? 0n)} AUSD` : `Review · ${formatAusd(units ?? 0n)} AUSD`) : "Enter a margin"}
        onPress={() => setSt({ step: "review" })} arrow disabled={!ok} py={14} variant="lime" accessibilityLabel="review"
      />
      <T w={400} s={10.5} lh={1.4} color={C.faint}>Nothing sent yet. Fills from the book; PnL and liquidation on mark.</T>
    </Page>
  );
}

/** Market sin contexto de Perpl todavía (arranque en frío por push): segmentado + créditos + escalera en skeleton (spec D3, P2 del plan F1). */
function MarketSkeleton() {
  return (
    <View>
      <View style={{ paddingTop: 4, paddingHorizontal: 18, paddingBottom: 6 }}>
        <Skeleton h={41} r={999} />
      </View>
      <Page top={13} gap={11}>
        <Skeleton.Card lines={1} />
        {Array.from({ length: 5 }, (_, i) => <Skeleton.Row key={i} />)}
      </Page>
    </View>
  );
}

export function MarketScreen(ctx: AppCtx) {
  const { S, set, perpl, nav } = ctx;
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId);
  // Agents no está en PERPL_SCREENS: si se llega sin mercado elegido (perpl.context aún null), se resuelve
  // en cuanto el contexto llegue, en vez de quedarse mostrando "isn't listed" (hooks siempre antes del early return).
  const fallbackId = S.perpsMarketId === undefined ? askMarketId(undefined, perpl.context?.markets ?? []) : undefined;
  useEffect(() => { if (fallbackId !== undefined) set({ perpsMarketId: fallbackId }); }, [fallbackId, set]);
  // Si el fetch del contexto falló, no hay fallbackId que resolver: cae al bloque !market, que ya muestra el error.
  if (S.perpsMarketId === undefined && !perpl.contextError) return <MarketSkeleton />;

  if (!market) {
    if (perpl.context === null && !perpl.contextError) return <MarketSkeleton />;
    return (
      <Page gap={11}>
        <T w={400} s={13} color={C.faint}>{perpl.contextError ? `Couldn't load markets. ${perpl.contextError}` : "This market isn't listed on Perpl anymore."}</T>
        <Btn label="Back to Markets" onPress={() => nav("markets")} variant="lime" accessibilityLabel="back-to-markets" />
      </Page>
    );
  }

  return (
    <View>
      <View style={{ paddingTop: 4, paddingHorizontal: 18, paddingBottom: 6 }}>
        <Segmented options={[["trade", "Trade it"], ["ask", "Ask an agent"]] as const} value={S.marketTab} onChange={(k) => set({ marketTab: k })} />
      </View>
      {S.marketTab === "trade" ? <TradeTab {...ctx} /> : <AskTab {...ctx} />}
    </View>
  );
}

/** Mark en vivo y % 24h a la derecha de la cabecera (D10). */
export function MarkBadge({ S, perpl }: AppCtx) {
  const m = perpl.context?.markets.find((x) => x.id === S.perpsMarketId);
  if (!m) return null;
  const chg = change24h(m.mark, m.prev);
  return (
    <View style={{ alignItems: "flex-end" }}>
      <T w={700} s={15} lh={1} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
      <T w={500} s={10.5} lh={1} mono color={chg >= 0 ? C.up : C.down} style={{ marginTop: 4 }}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(1)}%</T>
    </View>
  );
}

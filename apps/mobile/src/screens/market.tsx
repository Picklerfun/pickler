import { useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import { formatPrice, formatSize, leveragesFor, liquidationPrice, notionalAusd, type Side, sizeFromAusd, takerFee } from "../perpl/orders";
import { levelIsLive, levelTitle, reminderKinds, remindersCopy, resolvesLabel, sideFor } from "../reads/level";
import { cellLabel } from "../reads/matrix";
import type { TradeLevel } from "../store";
import { Btn, Card, Chip, KVList, type KVRow, Page, PillTabs, Segmented, Skeleton, StatusCard, T, Tag, type Tone } from "../ui/primitives";
import { C, pill, textStyle } from "../ui/theme";
import { AgentsTab } from "./agents";
import { AskTab } from "./ask";

export type OrderResult =
  | { step: "sent" }
  | { step: "filled"; title: string; detail: string; note?: string }
  | { step: "failed"; text: string }
  | { step: "unknown" };

/** Tonos de D14: sent = hair2/slab, filled = lima, failed = down, unknown = warn. */
const TONES = {
  sent: { tag: "SENT", title: "Order accepted — waiting for the fill", tone: { bd: C.hair2, bg: C.slab, fg: C.dim } },
  filled: { tag: "FILLED", title: "Filled", tone: { bd: C.limeBd, bg: C.limeBg06, fg: C.lime } },
  failed: { tag: "FAILED", title: "Order failed", tone: { bd: C.downBd, bg: C.downBg, fg: C.down } },
  unknown: { tag: "NO CONFIRMATION", title: "No confirmation yet", tone: { bd: C.warnBd, bg: C.warnBg, fg: C.warn } },
} as const satisfies Record<OrderResult["step"], { tag: string; title: string; tone: Tone }>;

/** Estados Sent / Filled / Failed / Unknown, compartidos por apertura (aquí) y cierre (markets.tsx). */
export function OrderResultCard({ result, onBack, onEdit }: { result: OrderResult; onBack: () => void; onEdit?: () => void }) {
  const t = TONES[result.step];
  const body = result.step === "filled" ? result.detail
    : result.step === "failed" ? result.text
    : result.step === "unknown" ? "Check your positions — the order may still have gone through."
    : undefined;
  return (
    <View style={{ gap: 11 }}>
      <StatusCard tag={t.tag} title={result.step === "filled" ? result.title : t.title} body={body} tone={t.tone}>
        {result.step === "sent" ? <ActivityIndicator color={C.dim} style={{ alignSelf: "flex-start" }} /> : null}
        {result.step === "filled" && result.note ? <T w={400} s={11.5} lh={1.4} color={C.dim} accessibilityLabel="order-note">{result.note}</T> : null}
      </StatusCard>
      {result.step !== "sent" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {result.step === "failed" && onEdit ? <Btn label="Edit" onPress={onEdit} variant="outline" flex={1} accessibilityLabel="edit-order" /> : null}
          <Btn label="Back to Markets" onPress={onBack} variant="lime" flex={1} accessibilityLabel="back-to-markets" />
        </View>
      ) : null}
    </View>
  );
}

type Step = { step: "edit" } | { step: "review" } | { step: "result"; result: OrderResult };

const TRADE_GATE: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime };

/** Sin trading key en este teléfono: el gate de Perpl vive aquí, no en Markets (fix gate, P3). El flujo real de Enable/Reconnect sigue en Markets. El botón navega a Markets (`nav("markets")`, no `back()`, porque Market también se abre desde un push). */
function TradeGate({ perpl, nav }: Pick<AppCtx, "perpl" | "nav">) {
  if (perpl.state.status === "loading") return <Page top={13}><ActivityIndicator color={C.lime} /></Page>;
  const existing = perpl.existingAccountId;
  const reconnect = existing !== null && existing > 0n;
  return (
    <Page top={13} gap={11}>
      <StatusCard tag="TRADE" title="Trading isn't set up on this phone" tone={TRADE_GATE}
        body={reconnect
          ? `This wallet already has Perpl account #${String(existing)}. Reconnect registers a trading key on this phone; no AUSD moves.`
          : "Enable trading moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps."}>
        <Btn label={reconnect ? "Reconnect trading" : "Enable trading"} onPress={() => nav("markets")} variant="lime" py={14} accessibilityLabel="trade-gate" />
      </StatusCard>
      <T w={400} s={11} lh={1.45} color={C.faint}>Ask and Agents work without a trading key.</T>
    </Page>
  );
}

const LEVEL: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime };

/** Nivel elegido en Ask (D12): target, vencimiento, lado sugerido y qué pasará tras la orden. Nada cierra la posición. */
function LevelCard({ symbol, level, pd, now, onRemove }: { symbol: string; level: TradeLevel; pd: number; now: number; onRemove: () => void }) {
  const side = sideFor(level.levelBps);
  const two = reminderKinds(level, now).length === 2;
  return (
    <Card bd={LEVEL.bd} bg={LEVEL.bg} gap={8}>
      <Tag color={LEVEL.fg}>TRADE THIS LEVEL · FROM ASK</Tag>
      <T w={700} s={16} lh={1.2} ls={-0.01} display accessibilityLabel="level-title">{levelTitle(symbol, level)} → {formatPrice(level.target, pd)}</T>
      <KVList rows={[
        { label: "TARGET", value: formatPrice(level.target, pd) },
        { label: "RESOLVES", value: resolvesLabel(level, now) },
        { label: "SUGGESTED", value: side.toUpperCase(), fg: side === "long" ? C.lime : C.down },
      ]} top />
      <T w={400} s={11} lh={1.45} color={C.dim}>{`Once your order fills: a reminder ${two ? "15 min before and one at expiry" : "at expiry"}. Nothing closes the position for you — close it from Markets.`}</T>
      <Btn label="Remove level" onPress={onRemove} variant="ghost" py={8} accessibilityLabel="level-remove" />
    </Card>
  );
}

function TradeTab({ S, set, perpl, reads, nav }: AppCtx) {
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId)!; // MarketScreen ya comprobó que existe
  const side: Side = S.perpsSide ?? "long";
  const free = perpl.live?.account ? perpl.live.account.b - perpl.live.account.lb : 0n;
  const [amount, setAmount] = useState("");
  const [lv, setLv] = useState(1);
  const [st, setSt] = useState<Step>({ step: "edit" });
  const now = useNow(30_000);
  // Sólo el nivel de este mercado y todavía vivo; uno de otro mercado se conserva en el store pero no se pinta ni programa nada.
  const level = S.tradeLevel && S.tradeLevel.marketId === market.id && levelIsLive(S.tradeLevel, now) ? S.tradeLevel : undefined;

  if (perpl.state.status !== "ready") return <TradeGate perpl={perpl} nav={nav} />;

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
    { label: "NOTIONAL", value: `≈ ${formatAusd(notional)} AUSD · ${formatSize(size, market.sizeDecimals)} ${sym}` },
    { label: "EST. PRICE", value: formatPrice(market.mark, market.priceDecimals) },
    { label: "FEE · TAKER", value: `≈ ${formatAusd(fee, 4)} AUSD`, fg: C.dim },
    { label: "LIQUIDATION ≈", value: formatPrice(liq, market.priceDecimals), fg: lvUsed > 1 ? C.down : C.dim },
    ...(level ? [{ label: "LEVEL", value: `${cellLabel(level)} → ${formatPrice(level.target, market.priceDecimals)}`, fg: C.lime }] : []),
  ];

  if (st.step === "result") {
    return <Page top={13}><OrderResultCard result={st.result} onBack={() => nav("markets")} onEdit={() => setSt({ step: "edit" })} /></Page>;
  }

  if (st.step === "review") {
    return (
      <Page top={13} gap={11}>
        <Card bd={side === "long" ? C.limeBd : C.downBd} bg={side === "long" ? C.limeBg06 : C.downBg} gap={8}>
          <Tag color={side === "long" ? C.lime : C.down}>YOU OPEN · {side.toUpperCase()} {sym} · {lvUsed}X · MARKET</Tag>
          <T w={700} s={22} lh={1.1} ls={-0.02} display>{formatAusd(units ?? 0n)} AUSD</T>
          <KVList rows={rows} top />
        </Card>
        {lvUsed > 1 ? <T w={400} s={11.5} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
        <Btn label={live ? `Confirm ${side}` : "Connecting…"} onPress={() => { void confirm(); }} variant="lime" py={14} disabled={!live} accessibilityLabel="confirm" />
        <Btn label="Change amount" onPress={() => setSt({ step: "edit" })} variant="ghost" accessibilityLabel="change-amount" />
        <T w={400} s={11} lh={1.45} color={C.faint}>Market order with up to {market.maxSlippageBps / 100}% slippage. Forwarded orders pay no gas.</T>
      </Page>
    );
  }

  return (
    <Page top={13} gap={11}>
      {level ? <LevelCard symbol={sym} level={level} pd={market.priceDecimals} now={now} onRemove={() => set({ tradeLevel: undefined })} /> : null}
      <Segmented
        options={[["long", "Long"], ["short", "Short"]] as const}
        value={side}
        onChange={(k) => set({ perpsSide: k })}
        tone={(k) => ({ bg: k === "long" ? C.lime : C.down, fg: C.onLime })}
      />
      <Card bd={C.hair2} bg={C.deep} gap={6}>
        <Tag>MARGIN · AUSD</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.faint} keyboardType="decimal-pad" accessibilityLabel="margin-input"
            style={[textStyle(700, 32, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]}
          />
          <Chip label="Max" onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} bd={C.hair22} fg={C.ink} accessibilityLabel="max" />
        </View>
        <T w={400} s={11.5} lh={1.4} color={C.dim}>{formatAusd(free)} AUSD free in trading</T>
      </Card>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {leverages.map((l) => {
          const p = pill(l === lvUsed);
          return <Chip key={l} label={`${l}x`} mono s={10} py={8} px={0} style={{ flex: 1 }} fg={p.fg} bd={p.bd} bg={p.bg} onPress={() => setLv(l)} accessibilityLabel={`lv-${l}`} />;
        })}
      </View>
      {leverages.length < 4 ? <T w={400} s={11} lh={1.4} color={C.faint}>{sym} allows up to {market.maxLeverage}x.</T> : null}
      <Card><KVList rows={rows} /></Card>
      {lvUsed > 1 ? <T w={400} s={11.5} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
      {error ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{error}</T> : null}
      <Btn label={ok ? `Review ${side} · ${formatAusd(units ?? 0n)} AUSD` : "Enter a margin"} onPress={() => setSt({ step: "review" })} arrow disabled={!ok} py={14} accessibilityLabel="review" />
      <T w={400} s={10.5} lh={1.4} color={C.faint}>Nothing sent yet. Fills from the book; PnL and liquidation on mark.</T>
    </Page>
  );
}

/** Market sin contexto de Perpl todavía (arranque en frío por push): pills + créditos + escalera en skeleton (spec D3, P2 del plan F1). */
function MarketSkeleton() {
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 11, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair12 }}>
        <Skeleton h={36} w="30%" r={999} style={{ flex: 1 }} /><Skeleton h={36} w="30%" r={999} style={{ flex: 1 }} /><Skeleton h={36} w="30%" r={999} style={{ flex: 1 }} />
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
      <View style={{ paddingTop: 11, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair12 }}>
        <PillTabs options={[["ask", "Ask"], ["trade", "Trade"], ["agents", "Agents"]] as const} value={S.marketTab} onChange={(k) => set({ marketTab: k })} />
      </View>
      {S.marketTab === "trade" ? <TradeTab {...ctx} /> : S.marketTab === "ask" ? <AskTab {...ctx} /> : <AgentsTab {...ctx} />}
    </View>
  );
}

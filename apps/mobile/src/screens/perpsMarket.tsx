import { useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { formatPrice, formatSize, leveragesFor, liquidationPrice, notionalAusd, type Side, sizeFromAusd, takerFee } from "../perpl/orders";
import { KV, Segmented, T, Touch } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";

export type OrderResult =
  | { step: "sent" }
  | { step: "filled"; title: string; detail: string }
  | { step: "failed"; text: string }
  | { step: "unknown" };

const TONES = {
  sent: { title: "Order accepted — waiting for the fill", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" },
  filled: { title: "Filled", fg: C.lime, bd: "rgba(200,240,58,0.45)", bg: "rgba(200,240,58,0.07)" },
  failed: { title: "Order failed", fg: C.down, bd: "rgba(242,119,122,0.5)", bg: "rgba(242,119,122,0.08)" },
  unknown: { title: "No confirmation yet", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" },
} as const;

const primaryBtn = { paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" } as const;
const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;

/** Estados Sent / Filled / Failed / Unknown, compartidos por apertura y cierre. */
export function OrderResultCard({ result, onBack, onEdit }: { result: OrderResult; onBack: () => void; onEdit?: () => void }) {
  const tone = TONES[result.step];
  return (
    <View style={{ gap: 13 }}>
      <View style={{ padding: 14, borderWidth: 1, borderColor: tone.bd, backgroundColor: tone.bg, borderRadius: 14, gap: 8 }}>
        <T w={700} s={14} color={tone.fg}>{result.step === "filled" ? result.title : tone.title}</T>
        {result.step === "filled" ? <T w={400} s={12.5} lh={1.4} mono color={C.dim}>{result.detail}</T> : null}
        {result.step === "failed" ? <T w={400} s={12.5} lh={1.4} color={C.dim}>{result.text}</T> : null}
        {result.step === "unknown" ? <T w={400} s={12.5} lh={1.4} color={C.dim}>Check your positions — the order may still have gone through.</T> : null}
        {result.step === "sent" ? <ActivityIndicator color={C.warn} /> : null}
      </View>
      {result.step !== "sent" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {result.step === "failed" && onEdit ? (
            <Touch onPress={onEdit} style={secondaryBtn}><T w={700} s={13.5}>Edit</T></Touch>
          ) : null}
          <Touch onPress={onBack} style={{ ...primaryBtn, flex: 1 }}><T w={700} s={14.5} color={C.onLime}>Back to Trade</T></Touch>
        </View>
      ) : null}
    </View>
  );
}

type Step = { step: "edit" } | { step: "review" } | { step: "result"; result: OrderResult };

export function PerpsMarketScreen({ S, set, perpl, nav }: AppCtx) {
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId);
  const side: Side = S.perpsSide ?? "long";
  const free = perpl.live?.account ? perpl.live.account.b - perpl.live.account.lb : 0n;
  const [amount, setAmount] = useState("");
  const [lv, setLv] = useState(1);
  const [st, setSt] = useState<Step>({ step: "edit" });

  if (!market) {
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <T w={400} s={13} color={C.mute}>{perpl.contextError ? `Couldn't load markets. ${perpl.contextError}` : "Loading market…"}</T>
        <Touch onPress={() => nav("perps")} style={primaryBtn}><T w={700} s={14.5} color={C.onLime}>Back to Trade</T></Touch>
      </View>
    );
  }

  const leverages = leveragesFor(market);
  const lvUsed = leverages.includes(lv) ? lv : 1;
  const units = parseAusd(amount);
  const size = units === undefined ? 0 : sizeFromAusd(units, lvUsed, market.mark, market.priceDecimals, market.sizeDecimals);
  const notional = notionalAusd(size, market.mark, market.priceDecimals, market.sizeDecimals);
  const fee = takerFee(notional, market.takerFeeMicros);
  const liq = liquidationPrice(market.mark, lvUsed, side, market.maintenanceBps, market.maxLeverage);
  const error = amount === "" ? "" : units === undefined || units === 0n ? "Enter an amount above zero." : units > free ? `That is more than the ${formatAusd(free)} AUSD free.` : size <= 0 ? "That amount is below one unit of this market." : "";
  const ok = units !== undefined && units > 0n && units <= free && size > 0;
  const live = perpl.live?.status === "live";
  const sym = market.symbol;

  const confirm = async () => {
    setSt({ step: "result", result: { step: "sent" } });
    const outcome = await perpl.open(market, side, units ?? 0n, lvUsed);
    setSt({ step: "result", result:
      outcome.kind === "filled" ? { step: "filled", title: `Filled ${formatSize(outcome.order.fs, market.sizeDecimals)} ${sym} at ${formatPrice(outcome.order.fp, market.priceDecimals)}`, detail: `Fee ${formatAusd(outcome.order.f)} AUSD · ${side.toUpperCase()} ${lvUsed}x` }
      : outcome.kind === "open" ? { step: "filled", title: "Placed — waiting in the book", detail: `${formatSize(outcome.order.os, market.sizeDecimals)} ${sym}` }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  const summary = [
    { label: "Size", value: `≈ ${formatSize(size, market.sizeDecimals)} ${sym}`, fg: C.ink },
    { label: "Est. price", value: formatPrice(market.mark, market.priceDecimals), fg: C.ink },
    { label: "Fee", value: `≈ ${formatAusd(fee)} AUSD`, fg: C.dim },
    { label: "Liquidation est.", value: formatPrice(liq, market.priceDecimals), fg: lvUsed > 1 ? C.warn : C.dim },
  ];

  if (st.step === "result") {
    return (
      <View style={{ padding: 16 }}>
        <OrderResultCard result={st.result} onBack={() => nav("perps")} onEdit={() => setSt({ step: "edit" })} />
      </View>
    );
  }

  if (st.step === "review") {
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: side === "long" ? C.lime : C.down, borderRadius: 14, backgroundColor: C.surf2 }}>
          <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>{side === "long" ? "Long" : "Short"} {sym} · {lvUsed}x · market order</T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T w={800} s={30} lh={1} ls={-0.03}>{formatAusd(units ?? 0n)}</T>
            <T w={500} s={14} mono color={C.mute}>AUSD</T>
          </View>
        </View>
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
          {summary.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
        </View>
        {lvUsed > 1 ? <T w={400} s={12} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => setSt({ step: "edit" })} style={secondaryBtn}><T w={700} s={13.5}>Edit</T></Touch>
          <Touch onPress={() => { void confirm(); }} disabled={!live} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: live ? C.lime : C.tile, alignItems: "center" }}>
            <T w={700} s={13.5} color={live ? C.onLime : C.disabled}>{live ? `Confirm ${side}` : "Connecting…"}</T>
          </Touch>
        </View>
        <T w={400} s={11.5} lh={1.45} color={C.mute}>Market order with up to {market.maxSlippageBps / 100}% slippage. Forwarded orders pay no gas.</T>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 13 }}>
      <Segmented options={(["long", "short"] as const).map((k) => ({
        label: k === "long" ? "Long" : "Short", bg: side === k ? (k === "long" ? C.lime : C.down) : "transparent", fg: side === k ? C.onLime : C.dim, strong: side === k, onPress: () => set({ perpsSide: k }),
      }))} />
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount in AUSD</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.mute} keyboardType="decimal-pad" style={[textStyle(800, 30, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]} />
          <T w={500} s={14} mono color={C.mute}>AUSD</T>
          <Touch onPress={() => setAmount(formatUnits(free, AUSD_DECIMALS))} style={chipBtn}><T w={600} s={12}>Max</T></Touch>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{formatAusd(free)} AUSD free in trading</T>
      </View>
      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>LEVERAGE</T>
        <Segmented options={leverages.map((l) => ({ label: `${l}x`, bg: lvUsed === l ? C.ink : "transparent", fg: lvUsed === l ? C.onInk : C.dim, onPress: () => setLv(l) }))} />
        {leverages.length < 4 ? <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginTop: 6 }}>{sym} allows up to {market.maxLeverage}x.</T> : null}
      </View>
      <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
        {summary.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
      </View>
      {lvUsed > 1 ? <T w={400} s={12} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
      {error ? <T w={400} s={12} lh={1.4} color={C.warn}>{error}</T> : null}
      <Touch onPress={() => setSt({ step: "review" })} disabled={!ok} style={{ ...primaryBtn, backgroundColor: ok ? C.lime : C.tile }}>
        <T w={700} s={14.5} color={ok ? C.onLime : C.disabled}>Review</T>
      </Touch>
    </View>
  );
}

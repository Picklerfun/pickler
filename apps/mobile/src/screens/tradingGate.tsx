import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, MON_FAUCET_URL, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { describeClockSkew, KEY_REJECTED_COPY } from "../perpl/clock";
import { PERPL_WEB } from "../perpl/config";
import type { Market } from "../perpl/context";
import { ENABLE_STEPS } from "../perpl/enable";
import { formatPnl, formatPrice, formatSize, liquidationPrice, positionPnl } from "../perpl/orders";
import type { Position } from "../perpl/ws";
import { Btn, Card, Chip, EmptyPanel, KV, Page, Reveal, Skeleton, T, Tag, Touch, Warn } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";
import { OrderResultCard, type OrderResult } from "./orderResult";

// Gate de trading, avisos y posiciones: salen de markets.tsx (spec mobile-light D7/D8) para que los usen Market y Portfolio.

/** Estado del socket de Perpl para el chip de conexión. */
export const CONNECTION = {
  live: { label: "LIVE", fg: C.limeInk, bd: C.limeBd },
  connecting: { label: "CONNECTING", fg: C.warn, bd: C.warnBd },
  reconnecting: { label: "RECONNECTING", fg: C.warn, bd: C.warnBd },
  closed: { label: "OFFLINE", fg: C.faint, bd: C.hair18 },
} as const;

function PositionRow({ p, market, onClose }: { p: Position; market: Market; onClose: () => void }) {
  const pnl = positionPnl(p, market.mark, market.priceDecimals, market.sizeDecimals);
  const lv = p.lv / 100;
  const long = p.sd === 1;
  const liq = liquidationPrice(p.ep, lv, long ? "long" : "short", market.maintenanceBps, market.maxLeverage);
  const pd = market.priceDecimals;
  return (
    <Card gap={12}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <T w={600} s={17} lh={1.2}>{long ? "Long" : "Short"} {market.symbol}</T>
          <T w={500} s={10.5} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>{formatSize(p.s, market.sizeDecimals)} {market.symbol} · {lv}×</T>
        </View>
        <T w={700} s={15} mono color={pnl <= -10_000n ? C.down : C.up}>{formatPnl(pnl)}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[["ENTRY", formatPrice(p.ep, pd)], ["MARK", formatPrice(market.mark, pd)], ["LIQ. EST.", formatPrice(liq, pd)]].map(([k, v]) => (
          <View key={k} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: C.bg }}>
            <Tag>{k}</Tag>
            <T w={700} s={12.5} mono style={{ marginTop: 5 }}>{v}</T>
          </View>
        ))}
      </View>
      <Btn label="Close" onPress={onClose} variant="outline" py={11} accessibilityLabel={`close-${p.pid}`} />
    </Card>
  );
}

type Closing = { p: Position; market: Market; result: OrderResult | null };

/** Enable / Reconnect trading con sus cuatro pasos (antes el `Gate` de Markets). */
export function EnableTrading({ perpl, treasury }: AppCtx) {
  const minOpen = perpl.context?.instance.minAccountOpen ?? 100_000_000n;
  const walletAusd = treasury.balances?.ausd ?? 0n;
  const noMon = treasury.balances?.mon === 0n;
  const [amount, setAmount] = useState<string | null>(null);
  const text = amount ?? formatUnits(minOpen, AUSD_DECIMALS);
  const units = parseAusd(text);
  const enableError = units === undefined || units === 0n ? "Enter an amount." : units < minOpen ? `Minimum is ${formatAusd(minOpen)} AUSD.` : units > walletAusd ? `That is more than the ${formatAusd(walletAusd)} AUSD in your wallet.` : "";
  const ob = perpl.state.status === "onboarding" ? perpl.state : null;
  const existing = perpl.existingAccountId;
  const reconnect = existing !== null && existing > 0n;
  // Retry tras un error: reconectar vuelve a pedir 0n; enable normal repite el monto escrito.
  const retryAmount = reconnect ? 0n : units;

  return (
    <Page gap={11}>
      <Card pad={15} gap={8}>
        <T w={700} s={17} lh={1.15} ls={-0.02} display>{reconnect ? "Reconnect trading" : "Enable trading"}</T>
        {ob === null ? (
          reconnect ? (
            <>
              <T w={400} s={12.5} lh={1.45} color={C.dim}>This wallet already has Perpl account #{String(existing)}. Reconnect registers a trading key on this phone; no AUSD moves.</T>
              {noMon ? <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }}><T w={400} s={12} lh={1.4} color={C.warn}>You need test MON for gas. Get some at the Monad faucet.</T></Touch> : null}
              <Btn label="Reconnect" onPress={() => { void perpl.enable(0n); }} variant="lime" py={14} disabled={noMon} accessibilityLabel="reconnect" />
            </>
          ) : (
            <>
              <T w={400} s={12.5} lh={1.45} color={C.dim}>Moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps.</T>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 }}>
                <TextInput value={text} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel="enable-input" style={[textStyle(700, 26, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]} />
                <T w={500} s={12} mono color={C.faint}>AUSD</T>
              </View>
              <T w={400} s={11.5} lh={1.4} color={C.dim}>{formatAusd(walletAusd)} AUSD in wallet · minimum {formatAusd(minOpen)}</T>
              {enableError ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{enableError}</T> : null}
              {noMon ? <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }}><T w={400} s={12} lh={1.4} color={C.warn}>You need test MON for gas. Get some at the Monad faucet.</T></Touch> : null}
              <Btn label="Enable trading" onPress={() => { if (units !== undefined && !enableError) void perpl.enable(units); }} variant="lime" py={14} disabled={!!enableError || noMon} accessibilityLabel="enable-trading" />
            </>
          )
        ) : (
          <View style={{ gap: 8, paddingTop: 2 }}>
            {ENABLE_STEPS.map((label, i) => {
              const n = i + 1;
              const state = n < ob.step ? "done" : n === ob.step ? (ob.error ? "error" : "busy") : "todo";
              return (
                <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {state === "busy" ? <ActivityIndicator size="small" color={C.limeInk} /> : <T w={700} s={13} mono color={state === "done" ? C.up : state === "error" ? C.down : C.faint}>{state === "done" ? "✓" : state === "error" ? "×" : "·"}</T>}
                  <T w={state === "todo" ? 400 : 600} s={13} color={state === "todo" ? C.faint : C.ink}>{label}</T>
                </View>
              );
            })}
            {ob.error ? <T w={400} s={12} lh={1.4} color={C.down}>{ob.error}</T> : null}
            {ob.error ? <Btn label="Retry" onPress={() => { if (retryAmount !== undefined) void perpl.enable(retryAmount); }} variant="outline" style={{ marginTop: 4 }} accessibilityLabel="retry-enable" /> : null}
          </View>
        )}
      </Card>
    </Page>
  );
}

/** Avisos de trading: reloj desfasado, key rechazada (Reset / Open Perpl) y forwarding apagado. */
export function TradingWarns({ perpl }: Pick<AppCtx, "perpl">) {
  const [actionError, setActionError] = useState("");
  // Reset key / Enable forwarding: sin catch la promesa rechazada se perdía. "" = Face ID cancelado (sin aviso).
  const runAction = async (action: () => Promise<void>) => {
    setActionError("");
    try { await action(); } catch (e) { setActionError(describeError(e)); }
  };
  const live = perpl.live;
  const acc = live?.account ?? null;
  const skew = describeClockSkew(perpl.clockSkewMs);

  return (
    <>
      {skew ? <Warn title={skew.title} body={skew.body} /> : null}
      {live?.keyRejected ? (
        <Warn title="Trading key rejected" body={KEY_REJECTED_COPY}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip label="Reset trading key" onPress={() => { void runAction(perpl.resetKey); }} bd={C.hair22} fg={C.ink} accessibilityLabel="reset-trading-key" />
            <Chip label="Open Perpl" onPress={() => { void Linking.openURL(PERPL_WEB); }} bd={C.hair22} fg={C.ink} accessibilityLabel="open-perpl" />
          </View>
          {actionError ? <T w={400} s={12} lh={1.4} color={C.down}>{actionError}</T> : null}
        </Warn>
      ) : null}
      {acc && !acc.fw ? (
        <Warn title="One-click trading is off" body="Orders will be rejected until it's enabled.">
          <Chip label="Enable" onPress={() => { void runAction(perpl.enableForwardingOnly); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} accessibilityLabel="enable-forwarding" />
          {actionError ? <T w={400} s={12} lh={1.4} color={C.down}>{actionError}</T> : null}
        </Warn>
      ) : null}
    </>
  );
}

/** Posiciones abiertas con Close y su confirmación inline (Portfolio → Positions, D17). */
export function PositionsPanel(ctx: AppCtx) {
  const { perpl } = ctx;
  const [closing, setClosing] = useState<Closing | null>(null);
  const live = perpl.live;
  const positions = live?.positions ?? [];
  const markets = perpl.context?.markets ?? [];

  const doClose = async (c: Closing) => {
    setClosing({ ...c, result: { step: "sent" } });
    const outcome = await perpl.close(c.market, c.p);
    const pd = c.market.priceDecimals, sd = c.market.sizeDecimals;
    setClosing({ ...c, result:
      outcome.kind === "filled" ? { step: "filled", title: `Closed ${formatSize(outcome.order.fs, sd)} ${c.market.symbol} at ${formatPrice(outcome.order.fp, pd)}`, detail: `Fee ${formatAusd(outcome.order.f, 4)} AUSD · realised PnL shows in the trading balance` }
      : outcome.kind === "open" ? { step: "filled", title: "Close order placed", detail: "Waiting in the book" }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  if (closing) {
    const pnl = positionPnl(closing.p, closing.market.mark, closing.market.priceDecimals, closing.market.sizeDecimals);
    const isLive = live?.status === "live";
    return (
      <Page gap={11}>
        {closing.result ? (
          <OrderResultCard result={closing.result} primary={{ label: "Back to Portfolio", onPress: () => setClosing(null) }} />
        ) : (
          <Card bd={C.hair2} bg={C.deep} gap={9}>
            <Tag>YOU CLOSE · AT MARKET</Tag>
            <T w={700} s={14} lh={1.3}>{formatSize(closing.p.s, closing.market.sizeDecimals)} {closing.market.symbol} {closing.p.sd === 1 ? "LONG" : "SHORT"}</T>
            <KV k="EST. PNL" v={`${formatPnl(pnl)} AUSD`} vFg={pnl <= -10_000n ? C.down : C.up} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn label="Keep it" onPress={() => setClosing(null)} variant="outline" flex={1} accessibilityLabel="keep-position" />
              <Btn label={isLive ? "Close position" : "Connecting…"} onPress={() => { void doClose(closing); }} variant="lime" flex={1} disabled={!isLive} accessibilityLabel="close-position" />
            </View>
          </Card>
        )}
      </Page>
    );
  }
  if (live === null) return <Skeleton.Card lines={3} />;
  if (positions.length === 0) return <Reveal><EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No open positions. Pick a market and a square.</T></EmptyPanel></Reveal>;
  return (
    <Reveal style={{ gap: 10 }}>
      {positions.map((p) => {
        const market = markets.find((m) => m.id === p.mkt);
        return market ? <PositionRow key={p.pid} p={p} market={market} onClose={() => setClosing({ p, market, result: null })} /> : null;
      })}
    </Reveal>
  );
}

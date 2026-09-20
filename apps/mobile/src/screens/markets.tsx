import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, MON_FAUCET_URL, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { describeClockSkew, KEY_REJECTED_COPY } from "../perpl/clock";
import { PERPL_WEB } from "../perpl/config";
import type { Market } from "../perpl/context";
import { ENABLE_STEPS } from "../perpl/enable";
import { change24h, formatPnl, formatPrice, formatSize, liquidationPrice, lockedCollateral, positionPnl, unrealisedPnl } from "../perpl/orders";
import type { Position } from "../perpl/ws";
import { Btn, Card, Chip, EmptyPanel, KV, Page, T, Tag, Touch, TouchCard, Warn } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";
import { OrderResultCard, type OrderResult } from "./market";

const CONNECTION = {
  live: { label: "LIVE", fg: C.lime, bd: C.limeBd },
  connecting: { label: "CONNECTING", fg: C.warn, bd: C.warnBd },
  reconnecting: { label: "RECONNECTING", fg: C.warn, bd: C.warnBd },
  closed: { label: "OFFLINE", fg: C.faint, bd: C.hair18 },
} as const;

function MarketsList({ perpl, nav, readOnly }: Pick<AppCtx, "perpl" | "nav"> & { readOnly: boolean }) {
  return (
    <View style={{ gap: 7 }}>
      <Tag s={10}>MARKETS</Tag>
      {perpl.contextError ? (
        <Warn title="Couldn't load markets" body={perpl.contextError}>
          <Chip label="Retry" onPress={() => { void perpl.refreshContext(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-markets" />
        </Warn>
      ) : null}
      {perpl.context === null && !perpl.contextError ? <T w={400} s={12} lh={1.4} color={C.faint}>Loading markets…</T> : null}
      {(perpl.context?.markets ?? []).map((m) => {
        const chg = change24h(m.mark, m.prev);
        return (
          <TouchCard
            key={m.id} pad={13} accessibilityLabel={`market-${m.symbol}`}
            onPress={readOnly ? undefined : () => nav("market", { perpsMarketId: m.id, perpsSide: "long", marketTab: "trade" })}
            style={{ flexDirection: "row", alignItems: "center", gap: 11, opacity: readOnly ? 0.7 : 1 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <T w={700} s={14} lh={1.2}>{m.symbol}</T>
              <T w={400} s={11} lh={1.2} color={C.faint} style={{ marginTop: 3 }}>{m.name} · up to {m.maxLeverage}x</T>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <T w={700} s={13} lh={1} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
              <T w={500} s={10.5} lh={1} mono color={chg >= 0 ? C.up : C.down} style={{ marginTop: 4 }}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(2)}%</T>
            </View>
          </TouchCard>
        );
      })}
    </View>
  );
}

function PositionRow({ p, market, onClose }: { p: Position; market: Market; onClose: () => void }) {
  const pnl = positionPnl(p, market.mark, market.priceDecimals, market.sizeDecimals);
  const lv = p.lv / 100;
  const long = p.sd === 1;
  const liq = liquidationPrice(p.ep, lv, long ? "long" : "short", market.maintenanceBps, market.maxLeverage);
  return (
    <Card gap={8}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Chip label={long ? "LONG" : "SHORT"} mono s={9.5} py={4} px={8} fg={long ? C.lime : C.down} bd={long ? C.limeBd : C.downBd} />
        <T w={600} s={13} style={{ flex: 1 }}>{formatSize(p.s, market.sizeDecimals)} {market.symbol} · {lv}x</T>
        <T w={700} s={13} mono color={pnl <= -10_000n ? C.down : C.up}>{formatPnl(pnl)} AUSD</T>
      </View>
      <T w={500} s={10} lh={1.4} mono color={C.faint}>{formatPrice(p.ep, market.priceDecimals)} → {formatPrice(market.mark, market.priceDecimals)} · LIQ. EST. {formatPrice(liq, market.priceDecimals)}</T>
      <Btn label="Close" onPress={onClose} variant="outline" py={10} accessibilityLabel={`close-${p.pid}`} />
    </Card>
  );
}

type Closing = { p: Position; market: Market; result: OrderResult | null };

function Gate({ perpl, treasury, nav }: AppCtx) {
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
                  {state === "busy" ? <ActivityIndicator size="small" color={C.lime} /> : <T w={700} s={13} mono color={state === "done" ? C.up : state === "error" ? C.down : C.faint}>{state === "done" ? "✓" : state === "error" ? "×" : "·"}</T>}
                  <T w={state === "todo" ? 400 : 600} s={13} color={state === "todo" ? C.faint : C.ink}>{label}</T>
                </View>
              );
            })}
            {ob.error ? <T w={400} s={12} lh={1.4} color={C.down}>{ob.error}</T> : null}
            {ob.error ? <Btn label="Retry" onPress={() => { if (retryAmount !== undefined) void perpl.enable(retryAmount); }} variant="outline" style={{ marginTop: 4 }} accessibilityLabel="retry-enable" /> : null}
          </View>
        )}
      </Card>
      <MarketsList perpl={perpl} nav={nav} readOnly />
    </Page>
  );
}

export function MarketsScreen(ctx: AppCtx) {
  const { perpl, nav } = ctx;
  const [closing, setClosing] = useState<Closing | null>(null);
  const [actionError, setActionError] = useState("");
  // Reset key / Enable forwarding: sin catch la promesa rechazada se perdía. "" = Face ID cancelado (sin aviso).
  const runAction = async (action: () => Promise<void>) => {
    setActionError("");
    try { await action(); } catch (e) { setActionError(describeError(e)); }
  };

  if (perpl.state.status === "loading") return <Page><ActivityIndicator color={C.lime} /></Page>;
  if (perpl.state.status === "none" || perpl.state.status === "onboarding") return <Gate {...ctx} />;

  const live = perpl.live;
  const acc = live?.account ?? null;
  const b = acc?.b ?? perpl.lastBalance ?? 0n;
  const positions = live?.positions ?? [];
  const markets = perpl.context?.markets ?? [];
  const locked = lockedCollateral(positions);
  const upnl = unrealisedPnl(positions, markets);
  const conn = CONNECTION[live?.status ?? "closed"];
  const skew = describeClockSkew(perpl.clockSkewMs);

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
          <OrderResultCard result={closing.result} onBack={() => setClosing(null)} />
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

  return (
    <Page gap={11}>
      <Card pad={15}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Tag>TRADING · AUSD</Tag>
          <Chip label={conn.label} mono s={9.5} py={4} px={8} fg={conn.fg} bd={conn.bd} />
        </View>
        <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{formatAusd(b)}</T>
        <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 8 }}>{formatAusd(locked)} in positions · {formatAusd(b)} free{acc ? "" : " · last seen"}</T>
        {upnl !== null ? <T w={500} s={10.5} lh={1.4} mono color={upnl <= -10_000n ? C.down : C.up} style={{ marginTop: 3 }}>{formatPnl(upnl)} unrealised PnL</T> : null}
      </Card>

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

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Add funds" onPress={() => nav("perpsFunds", { fundsMode: "add" })} variant="lime" flex={1} accessibilityLabel="add-funds" />
        <Btn label="Withdraw to wallet" onPress={() => nav("perpsFunds", { fundsMode: "withdraw" })} variant="outline2" flex={1} accessibilityLabel="withdraw-to-wallet" />
      </View>

      <MarketsList perpl={perpl} nav={nav} readOnly={false} />

      <View style={{ gap: 7 }}>
        <Tag s={10}>POSITIONS</Tag>
        {positions.length === 0 ? (
          <EmptyPanel><T w={400} s={12.5} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No open positions. Pick a market above.</T></EmptyPanel>
        ) : positions.map((p) => {
          const market = markets.find((m) => m.id === p.mkt);
          return market ? <PositionRow key={p.pid} p={p} market={market} onClose={() => setClosing({ p, market, result: null })} /> : null;
        })}
      </View>
    </Page>
  );
}

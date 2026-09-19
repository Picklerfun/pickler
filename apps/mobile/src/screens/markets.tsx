import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, MON_FAUCET_URL, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { PERPL_WEB } from "../perpl/config";
import type { Market } from "../perpl/context";
import { ENABLE_STEPS } from "../perpl/enable";
import { change24h, formatPrice, formatSize, liquidationPrice, lockedCollateral, positionPnl, unrealisedPnl } from "../perpl/orders";
import type { Position } from "../perpl/ws";
import { Chip, EmptyPanel, T, Touch, TouchCard } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";
import { OrderResultCard, type OrderResult } from "./market";

const primaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" } as const;
const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair22, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair22 } as const;
const warnBox = { paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: C.warnBd, backgroundColor: C.warnBg, borderRadius: 12, gap: 8 } as const;

const CONNECTION = {
  live: { label: "Live", fg: C.lime },
  connecting: { label: "Connecting…", fg: C.warn },
  reconnecting: { label: "Reconnecting…", fg: C.warn },
  closed: { label: "Offline", fg: C.faint },
} as const;

function MarketsList({ perpl, nav, readOnly }: Pick<AppCtx, "perpl" | "nav"> & { readOnly: boolean }) {
  return (
    <View>
      <T w={500} s={11} mono color={C.faint} style={{ marginBottom: 7 }}>MARKETS</T>
      {perpl.contextError ? (
        <View style={warnBox}>
          <T w={400} s={12} lh={1.4} color={C.warn}>Couldn't load markets. {perpl.contextError}</T>
          <Touch onPress={() => { void perpl.refreshContext(); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Retry</T></Touch>
        </View>
      ) : null}
      {perpl.context === null && !perpl.contextError ? <T w={400} s={12} lh={1.4} color={C.faint}>Loading markets…</T> : null}
      <View style={{ gap: 6 }}>
        {(perpl.context?.markets ?? []).map((m) => {
          const chg = change24h(m.mark, m.prev);
          return (
            <TouchCard key={m.id} onPress={readOnly ? undefined : () => nav("market", { perpsMarketId: m.id, perpsSide: "long" })} style={{ opacity: readOnly ? 0.7 : 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T w={700} s={14} lh={1.2}>{m.symbol}</T>
                  <T w={400} s={11.5} lh={1.2} color={C.faint} style={{ marginTop: 3 }}>{m.name} · up to {m.maxLeverage}x</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T w={500} s={13.5} lh={1.2} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
                  <T w={500} s={11.5} lh={1.2} mono color={chg >= 0 ? C.up : C.down} style={{ marginTop: 3 }}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(2)}%</T>
                </View>
              </View>
            </TouchCard>
          );
        })}
      </View>
    </View>
  );
}

function PositionRow({ p, market, onClose }: { p: Position; market: Market; onClose: () => void }) {
  const pnl = positionPnl(p, market.mark, market.priceDecimals, market.sizeDecimals);
  const lv = p.lv / 100;
  const liq = liquidationPrice(p.ep, lv, p.sd === 1 ? "long" : "short", market.maintenanceBps, market.maxLeverage);
  const long = p.sd === 1;
  return (
    <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.card, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Chip label={long ? "LONG" : "SHORT"} mono s={9.5} py={4} px={8} fg={long ? C.lime : C.down} bd={long ? C.limeBd : C.downBd} />
        <T w={600} s={13} style={{ flex: 1 }}>{formatSize(p.s, market.sizeDecimals)} {market.symbol} · {lv}x</T>
        <T w={600} s={13.5} mono color={pnl >= 0n ? C.up : C.down}>{pnl >= 0n ? "+" : "−"}{formatAusd(pnl < 0n ? -pnl : pnl)} AUSD</T>
      </View>
      <T w={400} s={11.5} lh={1.3} mono color={C.faint}>{formatPrice(p.ep, market.priceDecimals)} → {formatPrice(market.mark, market.priceDecimals)} · Liq. est. {formatPrice(liq, market.priceDecimals)}</T>
      <Touch onPress={onClose} style={{ ...secondaryBtn, paddingVertical: 10 }}><T w={700} s={13}>Close</T></Touch>
    </View>
  );
}

type Closing = { p: Position; market: Market; result: OrderResult | null };

export function MarketsScreen(ctx: AppCtx) {
  const { perpl, treasury, nav } = ctx;
  const minOpen = perpl.context?.instance.minAccountOpen ?? 100_000_000n;
  const walletAusd = treasury.balances?.ausd ?? 0n;
  const noMon = treasury.balances?.mon === 0n;
  const [amount, setAmount] = useState<string | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [actionError, setActionError] = useState("");
  const text = amount ?? formatUnits(minOpen, AUSD_DECIMALS);
  // Reset key / Enable forwarding: sin catch la promesa rechazada se perdía. "" = Face ID cancelado (sin aviso).
  const runAction = async (action: () => Promise<void>) => {
    setActionError("");
    try {
      await action();
    } catch (e) {
      setActionError(describeError(e));
    }
  };
  const units = parseAusd(text);
  const enableError = units === undefined || units === 0n ? "Enter an amount." : units < minOpen ? `Minimum is ${formatAusd(minOpen)} AUSD.` : units > walletAusd ? `That is more than the ${formatAusd(walletAusd)} AUSD in your wallet.` : "";

  if (perpl.state.status === "loading") {
    return <View style={{ padding: 16 }}><ActivityIndicator color={C.lime} /></View>;
  }

  if (perpl.state.status === "none" || perpl.state.status === "onboarding") {
    const ob = perpl.state.status === "onboarding" ? perpl.state : null;
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.card, gap: 10 }}>
          <T w={800} s={17} lh={1.15} ls={-0.03}>Enable trading</T>
          <T w={400} s={12.5} lh={1.45} color={C.dim}>Moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps.</T>
          {ob === null ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 4 }}>
                <TextInput value={text} onChangeText={setAmount} keyboardType="decimal-pad" style={[textStyle(700, 26, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]} />
                <T w={500} s={14} mono color={C.faint}>AUSD</T>
              </View>
              <T w={400} s={12} lh={1.4} color={C.dim}>{formatAusd(walletAusd)} AUSD in wallet · minimum {formatAusd(minOpen)}</T>
              {enableError ? <T w={400} s={12} lh={1.4} color={C.warn}>{enableError}</T> : null}
              {noMon ? (
                <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }}><T w={400} s={12} lh={1.4} color={C.warn}>You need test MON for gas. Get some at the Monad faucet.</T></Touch>
              ) : null}
              <Touch onPress={() => { if (units !== undefined && !enableError) void perpl.enable(units); }} disabled={!!enableError || noMon} style={{ ...primaryBtn, backgroundColor: enableError || noMon ? C.card10 : C.lime }}>
                <T w={700} s={14} color={enableError || noMon ? C.disabled : C.onLime}>Enable trading</T>
              </Touch>
            </>
          ) : (
            <View style={{ gap: 8, paddingTop: 4 }}>
              {ENABLE_STEPS.map((label, i) => {
                const n = i + 1;
                const state = n < ob.step ? "done" : n === ob.step ? (ob.error ? "error" : "busy") : "todo";
                return (
                  <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    {state === "busy" ? <ActivityIndicator size="small" color={C.lime} /> : <T w={700} s={13} color={state === "done" ? C.up : state === "error" ? C.down : C.faint}>{state === "done" ? "✓" : state === "error" ? "×" : "·"}</T>}
                    <T w={state === "todo" ? 400 : 600} s={13} color={state === "todo" ? C.faint : C.ink}>{label}</T>
                  </View>
                );
              })}
              {ob.error ? <T w={400} s={12} lh={1.4} color={C.down}>{ob.error}</T> : null}
              {ob.error ? (
                <Touch onPress={() => { if (units !== undefined) void perpl.enable(units); }} style={{ ...secondaryBtn, marginTop: 4 }}><T w={700} s={13.5}>Retry</T></Touch>
              ) : null}
            </View>
          )}
        </View>
        <MarketsList perpl={perpl} nav={nav} readOnly />
      </View>
    );
  }

  const live = perpl.live;
  const acc = live?.account ?? null;
  const b = acc?.b ?? perpl.lastBalance ?? 0n;
  const positions = live?.positions ?? [];
  const markets = perpl.context?.markets ?? [];
  const locked = lockedCollateral(positions);
  const upnl = unrealisedPnl(positions, markets);
  const conn = CONNECTION[live?.status ?? "closed"];

  const doClose = async (c: Closing) => {
    setClosing({ ...c, result: { step: "sent" } });
    const outcome = await perpl.close(c.market, c.p);
    const pd = c.market.priceDecimals, sd = c.market.sizeDecimals;
    setClosing({ ...c, result:
      outcome.kind === "filled" ? { step: "filled", title: `Closed ${formatSize(outcome.order.fs, sd)} ${c.market.symbol} at ${formatPrice(outcome.order.fp, pd)}`, detail: `Fee ${formatAusd(outcome.order.f)} AUSD · realised PnL shows in the trading balance` }
      : outcome.kind === "open" ? { step: "filled", title: "Close order placed", detail: "Waiting in the book" }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  if (closing) {
    const pnl = positionPnl(closing.p, closing.market.mark, closing.market.priceDecimals, closing.market.sizeDecimals);
    return (
      <View style={{ padding: 16, gap: 13 }}>
        {closing.result ? (
          <OrderResultCard result={closing.result} onBack={() => setClosing(null)} />
        ) : (
          <View style={{ padding: 14, borderWidth: 1, borderColor: C.hair22, borderRadius: 14, backgroundColor: C.deep, gap: 10 }}>
            <T w={700} s={14}>Close {formatSize(closing.p.s, closing.market.sizeDecimals)} {closing.market.symbol} {closing.p.sd === 1 ? "LONG" : "SHORT"} at market</T>
            <T w={400} s={12.5} lh={1.4} mono color={pnl >= 0n ? C.up : C.down}>Est. PnL {pnl >= 0n ? "+" : "−"}{formatAusd(pnl < 0n ? -pnl : pnl)} AUSD</T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Touch onPress={() => setClosing(null)} style={secondaryBtn}><T w={700} s={13.5}>Keep it</T></Touch>
              <Touch onPress={() => { void doClose(closing); }} disabled={live?.status !== "live"} style={{ ...primaryBtn, backgroundColor: live?.status === "live" ? C.lime : C.card10 }}>
                <T w={700} s={13.5} color={live?.status === "live" ? C.onLime : C.disabled}>Close position</T>
              </Touch>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T w={400} s={11.5} color={C.faint}>Trading balance</T>
          <Chip label={conn.label} s={10} py={4} px={9} fg={conn.fg} bd={conn.fg} />
        </View>
        <T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{formatAusd(b)} AUSD</T>
        <T w={400} s={12} lh={1.4} color={C.faint} style={{ marginTop: 8 }}>{formatAusd(locked)} in positions · {formatAusd(b)} free{acc ? "" : " · last seen"}</T>
        {upnl !== null ? (
          <T w={500} s={12} lh={1.4} mono color={upnl >= 0n ? C.up : C.down} style={{ marginTop: 4 }}>{upnl >= 0n ? "+" : "−"}{formatAusd(upnl < 0n ? -upnl : upnl)} unrealised PnL</T>
        ) : null}
      </View>

      {live?.keyRejected ? (
        <View style={warnBox}>
          <T w={400} s={12} lh={1.4} color={C.warn}>Trading key rejected. Perpl isn't available in some regions (see testnet.perpl.xyz).</T>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Touch onPress={() => { void runAction(perpl.resetKey); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Reset trading key</T></Touch>
            <Touch onPress={() => { void Linking.openURL(PERPL_WEB); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Open Perpl</T></Touch>
          </View>
          {actionError ? <T w={400} s={12} lh={1.4} color={C.down}>{actionError}</T> : null}
        </View>
      ) : null}
      {acc && !acc.fw ? (
        <View style={warnBox}>
          <T w={400} s={12} lh={1.4} color={C.warn}>One-click trading is off. Orders will be rejected until it's enabled.</T>
          <Touch onPress={() => { void runAction(perpl.enableForwardingOnly); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Enable</T></Touch>
          {actionError ? <T w={400} s={12} lh={1.4} color={C.down}>{actionError}</T> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => nav("perpsFunds", { fundsMode: "add" })} style={primaryBtn}><T w={700} s={13.5} color={C.onLime}>Add funds</T></Touch>
        <Touch onPress={() => nav("perpsFunds", { fundsMode: "withdraw" })} style={secondaryBtn}><T w={700} s={13.5}>Withdraw to wallet</T></Touch>
      </View>

      <MarketsList perpl={perpl} nav={nav} readOnly={false} />

      <View>
        <T w={500} s={11} mono color={C.faint} style={{ marginBottom: 7 }}>POSITIONS</T>
        {positions.length === 0 ? (
          <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No open positions. Pick a market above.</T></EmptyPanel>
        ) : (
          <View style={{ gap: 8 }}>
            {positions.map((p) => {
              const market = markets.find((m) => m.id === p.mkt);
              return market ? <PositionRow key={p.pid} p={p} market={market} onClose={() => setClosing({ p, market, result: null })} /> : null;
            })}
          </View>
        )}
      </View>
    </View>
  );
}

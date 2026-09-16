import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { accountAddress } from "../account";
import { EXPLORER_TX_URL, formatMon, MON_FAUCET_URL } from "../config/chain";
import type { AppCtx } from "../ctx";
import type { AgentId } from "../mock/data";
import { money } from "../mock/helpers";
import { EmptyPanel, KV, StatGrid, T, Touch, TouchCard } from "../ui/primitives";
import { C } from "../ui/theme";

type PositionRow = { initial: string; name: string; ticker: string; qty: string; avg: string; value: string; pl: string; plFg: string; agentId: AgentId };

export function PortfolioScreen({ holds, balance, nav }: AppCtx) {
  const empty = !holds;
  const cash = money(balance) + " AUSD";
  const pf = {
    tokensValue: empty ? "0.00" : "241.38",
    pl: empty ? "—" : "+24.60 AUSD",
    plFg: empty ? C.mute : C.up,
    total: empty ? cash : "559.78 AUSD",
  };
  const positions: PositionRow[] = empty ? [] : [
    { initial: "P", name: "Pickle", ticker: "PKL", qty: "4,820 PKL", avg: "0.0361", value: "198.58", pl: "+24.60", plFg: C.up, agentId: "pkl" },
    { initial: "M", name: "Moss", ticker: "MOSS", qty: "320 MOSS", avg: "not available", value: "42.80", pl: "—", plFg: C.mute, agentId: "moss" },
  ];

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf }}>
        <T w={400} s={11.5} color={C.mute}>Token positions · value in AUSD</T>
        <T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{pf.tokensValue}</T>
        <T w={500} s={13} mono color={pf.plFg} style={{ marginTop: 8 }}>{pf.pl} <T w={400} s={12} color={C.mute}>unrealised · since purchase</T></T>
        <View style={{ marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.hairSoft, flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <T w={400} s={12} lh={1.3} color={C.dim}>AUSD in wallet, counted separately</T>
          <T w={500} s={12.5} lh={1.3} mono>{cash}</T>
        </View>
        <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <T w={600} s={12.5} lh={1.3}>Total value</T>
          <T w={600} s={12.5} lh={1.3} mono>{pf.total}</T>
        </View>
      </View>

      {empty ? (
        <EmptyPanel>
          <T w={700} s={15} lh={1.25} style={{ marginBottom: 6 }}>No positions yet</T>
          <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", marginBottom: 14 }}>Your {cash} is sitting in the wallet. Buying a token moves part of it here.</T>
          <Touch onPress={() => nav("market")} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: C.lime }}>
            <T w={700} s={12.5} color={C.onLime}>Find an agent</T>
          </Touch>
        </EmptyPanel>
      ) : null}

      {positions.map((p) => (
        <TouchCard key={p.agentId} onPress={() => nav("position", { agentId: p.agentId })}>
          <View style={{ flexDirection: "row", gap: 11, alignItems: "center" }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.tile, alignItems: "center", justifyContent: "center" }}>
              <T w={800} s={13} color={C.dim}>{p.initial}</T>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T w={700} s={14} lh={1.2}>{p.name} · {p.ticker}</T>
              <T w={400} s={11.5} lh={1.2} mono color={C.mute} style={{ marginTop: 3 }}>{p.qty} · avg {p.avg}</T>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <T w={500} s={13.5} lh={1.2} mono>{p.value}</T>
              <T w={500} s={11.5} lh={1.2} mono color={p.plFg} style={{ marginTop: 3 }}>{p.pl}</T>
            </View>
          </View>
        </TouchCard>
      ))}

      <Touch onPress={() => nav("wallet")} style={{ paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
        <T w={600} s={13}>Purchase & sale history</T>
      </Touch>
    </View>
  );
}

export function PositionScreen({ agent: a, nav }: AppCtx) {
  const rows = [
    { label: "Average cost", value: "0.0361 AUSD", fg: C.ink },
    { label: "Cost basis", value: "173.98 AUSD", fg: C.ink },
    { label: "Unrealised P/L", value: "+24.60 AUSD", fg: C.up },
    { label: "Realised P/L", value: "+12.00 AUSD", fg: C.up },
  ];
  const history = [
    { kind: "Bought", when: "Sep 15, 09:42", qty: "+5,998.2 PKL", value: "250.00 AUSD" },
    { kind: "Sold", when: "Aug 02, 16:10", qty: "−1,500 PKL", value: "58.20 AUSD" },
    { kind: "Bought", when: "Jul 21, 11:05", qty: "+321.8 PKL", value: "11.40 AUSD" },
  ];
  return (
    <View style={{ padding: 16, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf }}>
        <T w={400} s={11.5} color={C.mute}>Current value · AUSD</T>
        <T w={800} s={28} lh={1} ls={-0.04} style={{ marginTop: 8 }}>198.58</T>
        <T w={500} s={12.5} mono color={C.mute} style={{ marginTop: 7 }}>4,820 {a.tickerBare} · 4,820 available to sell</T>
      </View>

      <StatGrid items={rows} />
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Realised and unrealised are kept apart, and neither is the agent's own profit or loss.</T>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>YOUR TRADES IN THIS TOKEN</T>
        <View style={{ gap: 6 }}>
          {history.map((h, i) => (
            <View key={i} style={{ padding: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf, flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <View>
                <T w={600} s={12.5} lh={1.2}>{h.kind}</T>
                <T w={400} s={11} lh={1.2} mono color={C.mute} style={{ marginTop: 3 }}>{h.when}</T>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <T w={500} s={12.5} lh={1.2} mono>{h.qty}</T>
                <T w={400} s={11} lh={1.2} mono color={C.mute} style={{ marginTop: 3 }}>{h.value}</T>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => nav("trade", { mode: "buy", phase: "quote" })} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
          <T w={700} s={13.5} color={C.onLime}>Buy more</T>
        </Touch>
        <Touch onPress={() => nav("trade", { mode: "sell", phase: "quote" })} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
          <T w={700} s={13.5}>Sell</T>
        </Touch>
      </View>
      <Touch onPress={() => nav("agent", { tab: "token" })} style={{ paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
        <T w={600} s={13}>Open agent</T>
      </Touch>
    </View>
  );
}

type Move = { kind: string; amount: string; fg: string; when: string; ref: string; status: string; stFg: string };

const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;

export function WalletScreen({ balance, nav, account, treasury, lock, signOut, resetTo }: AppCtx) {
  const available = treasury.balances ? money(balance) + " AUSD" : "—";
  const pending = balance === 0
    ? "Nothing pending. Nothing has ever arrived in this wallet."
    : "50.00 AUSD pending · a deposit is still confirming";
  const moves: Move[] = [
    { kind: "Deposit", amount: "+500.00 AUSD", fg: C.up, when: "Sep 15, 09:20", ref: "0x7ac4…e0b3", status: "Confirming", stFg: C.warn },
    { kind: "Bought PKL", amount: "−250.00 AUSD", fg: C.ink, when: "Sep 15, 09:42", ref: "0x4d1a…77c", status: "Complete", stFg: C.up },
    { kind: "Sold MOSS", amount: "+58.20 AUSD", fg: C.up, when: "Aug 02, 16:10", ref: "0x88fd…1a4", status: "Complete", stFg: C.up },
    { kind: "Withdrawal", amount: "−120.00 AUSD", fg: C.ink, when: "Jul 28, 10:02", ref: "0x12cc…903", status: "Complete", stFg: C.up },
  ];
  const txHash = treasury.notice.split(": ")[1];
  const unlocked = account.status === "unlocked";

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf }}>
        <T w={400} s={11.5} color={C.mute}>Available to spend</T>
        <T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{available}</T>
        <T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 8 }}>{pending}</T>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => nav("deposit")} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
          <T w={700} s={13.5} color={C.onLime}>Deposit</T>
        </Touch>
        <Touch onPress={() => nav("withdraw")} style={secondaryBtn}>
          <T w={700} s={13.5}>Withdraw</T>
        </Touch>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>TESTNET</T>
        <View style={{ gap: 8 }}>
          <View style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <T w={600} s={13}>MON (gas)</T>
            <T w={500} s={13} mono>{treasury.balances ? formatMon(treasury.balances.mon) : "—"}</T>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Touch onPress={() => { void treasury.getTestAusd(); }} disabled={treasury.busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: treasury.busy ? 0.6 : 1 }}>
              {treasury.busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>Get test AUSD</T>}
            </Touch>
            <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }} style={secondaryBtn}>
              <T w={700} s={13.5}>Get test MON</T>
            </Touch>
          </View>
          <Touch onPress={() => { void treasury.refresh(); }} style={secondaryBtn}>
            <T w={600} s={13}>Refresh</T>
          </Touch>
          {treasury.rpcError ? (
            <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(245,195,91,0.5)", backgroundColor: "rgba(245,195,91,0.1)", borderRadius: 12, gap: 8 }}>
              <T w={400} s={12} lh={1.4} color={C.warn}>{treasury.rpcError}</T>
              <Touch onPress={() => { void treasury.refresh(); }} style={{ alignSelf: "flex-start", ...chipBtn }}>
                <T w={600} s={12}>Retry</T>
              </Touch>
            </View>
          ) : null}
          {treasury.notice ? (
            <Touch onPress={() => { if (txHash) void Linking.openURL(EXPLORER_TX_URL(txHash)); }}>
              <T w={400} s={11.5} lh={1.4} mono color={C.up}>{treasury.notice}</T>
            </Touch>
          ) : null}
          {treasury.error ? <T w={400} s={12} lh={1.4} color={C.down}>{treasury.error}</T> : null}
        </View>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>MOVEMENTS</T>
        <View style={{ gap: 6 }}>
          {moves.map((m, i) => (
            <View key={i} style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <T w={600} s={13} lh={1.2}>{m.kind}</T>
                <T w={500} s={13} lh={1.2} mono color={m.fg}>{m.amount}</T>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 5 }}>
                <T w={400} s={11} lh={1.3} mono color={C.mute}>{m.when} · {m.ref}</T>
                <T w={500} s={11} lh={1.3} color={m.stFg}>{m.status}</T>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>SESSION</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T w={400} s={12.5} color={C.mute} style={{ flex: 1 }}>{unlocked ? "Unlocked" : "Locked"}</T>
          {unlocked ? (
            <Touch onPress={lock} style={chipBtn}>
              <T w={600} s={12.5}>Lock</T>
            </Touch>
          ) : null}
          <Touch onPress={() => { void signOut().then(() => resetTo("market")); }} style={chipBtn}>
            <T w={600} s={12.5}>Sign out</T>
          </Touch>
        </View>
      </View>
    </View>
  );
}

export function DepositScreen({ S, nav, account }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const [copied, setCopied] = useState(false);

  return (
    <View style={{ padding: 16, gap: 13 }}>
      {S.resume ? (
        <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(122,92,255,0.5)", backgroundColor: "rgba(122,92,255,0.12)", borderRadius: 12 }}>
          <T w={600} s={12.5} lh={1.4}>Deposit to finish your purchase</T>
          <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 3 }}>250.00 AUSD of PKL (Pickle) — we keep it for you.</T>
        </View>
      ) : null}
      <StatGrid items={[{ label: "Asset", value: "AUSD", fg: C.ink }, { label: "Network", value: "Monad", fg: C.ink }]} />
      <View style={{ height: 150, borderWidth: 1, borderColor: C.hair2, borderStyle: "dashed", borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.surf }}>
        <T w={500} s={11.5} mono color={C.mute}>QR code · deposit address</T>
      </View>
      <View style={{ padding: 13, borderWidth: 1, borderColor: C.hair, borderRadius: 13, backgroundColor: C.surf }}>
        <T w={400} s={11} color={C.mute}>Your deposit address</T>
        <T w={500} s={12.5} lh={1.45} mono style={{ marginTop: 6 }}>{address}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => { void Clipboard.setStringAsync(address).then(() => setCopied(true)); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
          <T w={700} s={13.5} color={C.onLime}>{copied ? "Copied" : "Copy address"}</T>
        </Touch>
        <Touch onPress={() => nav("trade", { phase: "quote", resume: true })} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
          <T w={700} s={13.5}>I've sent it</T>
        </Touch>
      </View>
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Only AUSD on Monad arrives here. Card and bank transfer are not assumed to exist. Whether a gas asset is also needed is still open.</T>
    </View>
  );
}

export function WithdrawScreen({ balance, nav }: AppCtx) {
  const rows = [
    { label: "Network", value: "Monad", fg: C.ink },
    { label: "Network fee · example", value: "−0.15 AUSD", fg: C.dim },
    { label: "Platform fee", value: "0.00 AUSD", fg: C.dim },
    { label: "You receive", value: "399.85 AUSD", fg: C.lime },
  ];
  return (
    <View style={{ padding: 16, gap: 13 }}>
      <View style={{ padding: 13, borderWidth: 1, borderColor: C.hair2, borderRadius: 13, backgroundColor: C.surf2 }}>
        <T w={400} s={11} color={C.mute}>Destination address</T>
        <T w={500} s={12.5} lh={1.4} mono color={C.mute} style={{ marginTop: 6 }}>Paste or scan an address</T>
      </View>
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount to withdraw</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <T w={800} s={30} lh={1} ls={-0.03}>400.00</T>
          <T w={500} s={14} mono color={C.mute}>AUSD</T>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{money(balance)} AUSD available</T>
      </View>
      <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
        {rows.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
      </View>
      <Touch onPress={() => nav("wallet")} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" }}>
        <T w={700} s={14.5} color={C.onLime}>Review withdrawal</T>
      </Touch>
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Network fee shown as an example. Who pays gas, and in what asset, is an open dependency.</T>
    </View>
  );
}

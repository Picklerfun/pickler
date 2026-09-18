import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Address, type Hex } from "viem";
import { accountAddress } from "../account";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd, formatMon, MON_FAUCET_URL, shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import type { AgentId } from "../mock/data";
import { money } from "../mock/helpers";
import { EmptyPanel, KV, StatGrid, T, Touch, TouchCard } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import type { Movement } from "../wallet/explorer";
import { describeError } from "../wallet/wallet";
import { validateWithdraw } from "../wallet/withdraw";

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

function movementDate(when: number): string {
  return new Date(when * 1000).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

const STATUS_FG: Record<Movement["status"], string> = { Complete: C.up, Confirming: C.warn, Reverted: C.down };

function MovementRow({ m }: { m: Movement }) {
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(m.hash)); }} style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <T w={600} s={13} lh={1.2}>{m.kind}</T>
        <T w={500} s={13} lh={1.2} mono color={m.sign === "+" ? C.up : C.ink}>{m.sign === "+" ? "+" : "−"}{formatAusd(m.amount)} AUSD</T>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 5 }}>
        <T w={400} s={11} lh={1.3} mono color={C.mute}>{movementDate(m.when)} · {shortHash(m.hash)}</T>
        <T w={500} s={11} lh={1.3} color={STATUS_FG[m.status]}>{m.status}</T>
      </View>
    </Touch>
  );
}

const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;

export function WalletScreen({ nav, account, treasury, perpl, lock, signOut, resetTo }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const available = treasury.balances ? formatAusd(treasury.balances.ausd) + " AUSD" : "—";
  const confirming = treasury.pending.filter((m) => m.status === "Confirming").length;
  const pending = confirming === 0
    ? "Nothing pending."
    : `${confirming} transfer${confirming === 1 ? "" : "s"} confirming`;
  const seen = new Set(treasury.pending.map((m) => m.hash));
  const rows = [...treasury.pending, ...(treasury.movements ?? []).filter((m) => !seen.has(m.hash))];
  const txHash = treasury.notice.split(": ")[1];
  const unlocked = account.status === "unlocked";

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf }}>
        <T w={400} s={11.5} color={C.mute}>Available to spend</T>
        <T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{available}</T>
        <T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 8 }}>{pending}</T>
        {perpl.state.status === "ready" ? (
          <Touch onPress={() => nav("perps")}>
            <T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 4 }}>
              {formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)} AUSD in trading{perpl.live?.account ? "" : perpl.lastBalance !== null ? " · last seen" : ""} · Trade tab
            </T>
          </Touch>
        ) : null}
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
          <View style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <T w={600} s={13}>Your address</T>
            <T w={500} s={13} mono>{address ? shortHash(address) : "—"}</T>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Touch onPress={() => { void treasury.getTestAusd(); }} disabled={treasury.busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: treasury.busy ? 0.6 : 1 }}>
              {treasury.busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>Get test AUSD</T>}
            </Touch>
            <Touch
              onPress={() => {
                void Clipboard.setStringAsync(address).catch(() => {});
                void Linking.openURL(MON_FAUCET_URL);
              }}
              style={secondaryBtn}
            >
              <T w={700} s={13.5}>Get test MON · copies address</T>
            </Touch>
          </View>
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
          {treasury.movementsError ? (
            <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(245,195,91,0.5)", backgroundColor: "rgba(245,195,91,0.1)", borderRadius: 12, gap: 8 }}>
              <T w={400} s={12} lh={1.4} color={C.warn}>Couldn't load movements. {treasury.movementsError}</T>
              <Touch onPress={() => { void treasury.refreshMovements(); }} style={{ alignSelf: "flex-start", ...chipBtn }}>
                <T w={600} s={12}>Retry</T>
              </Touch>
            </View>
          ) : null}
          {treasury.movements === null && !treasury.movementsError ? (
            <T w={400} s={12} lh={1.4} color={C.mute}>Loading movements…</T>
          ) : null}
          {treasury.movements !== null && rows.length === 0 ? (
            <T w={400} s={12} lh={1.4} color={C.mute}>Nothing has ever arrived in this wallet.</T>
          ) : null}
          {rows.map((m) => <MovementRow key={m.hash} m={m} />)}
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

type WithdrawStep = { step: "edit" } | { step: "review"; to: Address; amount: bigint; fee: bigint | null } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const inputStyle = { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair2, borderRadius: 11, backgroundColor: C.surf } as const;

export function WithdrawScreen({ nav, treasury }: AppCtx) {
  const ausd = treasury.balances?.ausd ?? 0n;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [st, setSt] = useState<WithdrawStep>({ step: "edit" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = validateWithdraw({ to, amount, ausd });

  const review = async () => {
    if (!check.ok) return;
    setError("");
    setSt({ step: "review", to: check.to, amount: check.amount, fee: null });
    try {
      const fee = await treasury.estimateFee(check.to, check.amount);
      setSt((s) => s.step === "review" ? { ...s, fee } : s);
    } catch (e) {
      setError(describeError(e) || "Couldn't estimate the network fee.");
    }
  };

  const confirm = async () => {
    if (st.step !== "review") return;
    setBusy(true);
    setError("");
    try {
      const status = await treasury.withdraw(st.to, st.amount, (hash) => setSt({ step: "sent", hash }));
      setSt((s) => s.step === "sent" ? { step: status === "success" ? "done" : "failed", hash: s.hash } : s);
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
      setSt((s) => s.step === "sent" ? { step: "unknown", hash: s.hash } : s);
    } finally {
      setBusy(false);
    }
  };

  if (st.step === "sent" || st.step === "done" || st.step === "failed" || st.step === "unknown") {
    const tone = st.step === "done" ? { title: "Withdrawal complete", fg: C.lime, bd: "rgba(200,240,58,0.45)", bg: "rgba(200,240,58,0.07)" }
      : st.step === "failed" ? { title: "Withdrawal reverted", fg: C.down, bd: "rgba(242,119,122,0.5)", bg: "rgba(242,119,122,0.08)" }
      : st.step === "unknown" ? { title: "Sent · confirmation not received", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" }
      : { title: "Sent · waiting for confirmation", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" };
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 14, borderWidth: 1, borderColor: tone.bd, backgroundColor: tone.bg, borderRadius: 14, gap: 8 }}>
          <T w={700} s={14} color={tone.fg}>{tone.title}</T>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }}>
            <T w={400} s={11.5} lh={1.4} mono color={C.dim}>{st.hash}</T>
          </Touch>
          {st.step === "unknown" && error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
          {st.step === "unknown" ? <T w={400} s={12} lh={1.4} color={C.mute}>Check the movements list — it may still confirm.</T> : null}
        </View>
        {st.step !== "sent" ? (
          <Touch onPress={() => nav("wallet")} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" }}>
            <T w={700} s={14.5} color={C.onLime}>Back to wallet</T>
          </Touch>
        ) : <ActivityIndicator color={C.lime} />}
      </View>
    );
  }

  if (st.step === "review") {
    const rows = [
      { label: "Network", value: "Monad", fg: C.ink },
      { label: "Network fee", value: st.fee !== null ? `~${formatMon(st.fee)} MON` : error ? "unavailable" : "estimating…", fg: C.dim },
      { label: "Platform fee", value: "0.00 AUSD", fg: C.dim },
      { label: "You receive", value: `${formatAusd(st.amount)} AUSD`, fg: C.lime },
    ];
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 13, borderWidth: 1, borderColor: C.hair, borderRadius: 13, backgroundColor: C.surf }}>
          <T w={400} s={11} color={C.mute}>Destination address</T>
          <T w={500} s={12.5} lh={1.45} mono style={{ marginTop: 6 }}>{st.to}</T>
        </View>
        <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
          <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount to withdraw</T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T w={800} s={30} lh={1} ls={-0.03}>{formatAusd(st.amount)}</T>
            <T w={500} s={14} mono color={C.mute}>AUSD</T>
          </View>
        </View>
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
          {rows.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
        </View>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => { setError(""); setSt({ step: "edit" }); }} disabled={busy} style={secondaryBtn}>
            <T w={700} s={13.5}>Edit</T>
          </Touch>
          <Touch onPress={() => { void confirm(); }} disabled={busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: busy ? 0.6 : 1 }}>
            {busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>Confirm withdrawal</T>}
          </Touch>
        </View>
        <T w={400} s={11.5} lh={1.45} color={C.mute}>Gas is paid in MON from this wallet. The AUSD amount arrives in full.</T>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 13 }}>
      <View style={inputStyle}>
        <T w={400} s={11} color={C.mute}>Destination address</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Paste a Monad address"
            placeholderTextColor={C.mute}
            autoCapitalize="none"
            autoCorrect={false}
            style={[textStyle(500, 12.5, { mono: true, color: C.ink }), { flex: 1, paddingVertical: 6 }]}
          />
          <Touch onPress={() => { void Clipboard.getStringAsync().then((s) => setTo(s.trim())).catch(() => {}); }} style={chipBtn}>
            <T w={600} s={12}>Paste</T>
          </Touch>
        </View>
      </View>
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount to withdraw</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C.mute}
            keyboardType="decimal-pad"
            style={[textStyle(800, 30, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]}
          />
          <T w={500} s={14} mono color={C.mute}>AUSD</T>
          <Touch onPress={() => setAmount(formatUnits(ausd, AUSD_DECIMALS))} style={chipBtn}>
            <T w={600} s={12}>Max</T>
          </Touch>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{formatAusd(ausd)} AUSD available</T>
      </View>
      {!check.ok && (to !== "" || amount !== "") ? <T w={400} s={12} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Touch onPress={() => { void review(); }} disabled={!check.ok} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: check.ok ? C.lime : C.tile, alignItems: "center" }}>
        <T w={700} s={14.5} color={check.ok ? C.onLime : C.disabled}>Review withdrawal</T>
      </Touch>
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Only AUSD on Monad. Gas is paid in MON from this wallet.</T>
    </View>
  );
}

import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Hex } from "viem";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { type FundsMode, validateFunds } from "../perpl/funds";
import { KV, Segmented, StatGrid, T, Touch } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";

type Step = { step: "edit" } | { step: "review"; amount: bigint } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const primaryBtn = { paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" } as const;
const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair22, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair22 } as const;

export function PerpsFundsScreen({ S, set, perpl, treasury, nav }: AppCtx) {
  const mode: FundsMode = S.fundsMode ?? "add";
  const wallet = treasury.balances?.ausd ?? 0n;
  const acc = perpl.live?.account;
  const free = acc ? acc.b - acc.lb : 0n;
  const minDeposit = perpl.context?.instance.minDeposit ?? 10_000_000n;
  const minWithdraw = perpl.context?.instance.minWithdraw ?? 10_000n;
  const [amount, setAmount] = useState("");
  const [st, setSt] = useState<Step>({ step: "edit" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = validateFunds(mode, amount, wallet, free, minDeposit, minWithdraw);
  const max = mode === "add" ? wallet : free;

  const confirm = async () => {
    if (st.step !== "review") return;
    setBusy(true);
    setError("");
    try {
      const run = mode === "add" ? perpl.addFunds : perpl.withdraw;
      const status = await run(st.amount, (hash) => setSt({ step: "sent", hash }));
      setSt((s) => s.step === "sent" ? { step: status === "success" ? "done" : "failed", hash: s.hash } : s);
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
      setSt((s) => s.step === "sent" ? { step: "unknown", hash: s.hash } : s);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <StatGrid items={[
      { label: "Wallet", value: `${formatAusd(wallet)} AUSD`, fg: C.ink },
      { label: "Trading · free", value: acc ? `${formatAusd(free)} AUSD` : perpl.lastBalance !== null ? `${formatAusd(perpl.lastBalance)} · last seen` : "—", fg: C.ink },
    ]} />
  );

  if (st.step === "sent" || st.step === "done" || st.step === "failed" || st.step === "unknown") {
    const tone = st.step === "done" ? { title: mode === "add" ? "Funds added" : "Withdrawn to wallet", fg: C.lime, bd: C.limeBd, bg: C.limeBg06 }
      : st.step === "failed" ? { title: "Transaction reverted", fg: C.down, bd: C.downBd, bg: C.downBg }
      : st.step === "unknown" ? { title: "Sent · confirmation not received", fg: C.warn, bd: C.warnBd, bg: C.warnBg }
      : { title: "Sent · waiting for confirmation", fg: C.warn, bd: C.warnBd, bg: C.warnBg };
    return (
      <View style={{ padding: 16, gap: 13 }}>
        {header}
        <View style={{ padding: 14, borderWidth: 1, borderColor: tone.bd, backgroundColor: tone.bg, borderRadius: 14, gap: 8 }}>
          <T w={700} s={14} color={tone.fg}>{tone.title}</T>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }}><T w={400} s={11.5} lh={1.4} mono color={C.dim}>{st.hash}</T></Touch>
          {st.step === "unknown" && error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        </View>
        {st.step !== "sent" ? (
          <Touch onPress={() => nav("markets")} style={primaryBtn}><T w={700} s={14.5} color={C.onLime}>Back to Markets</T></Touch>
        ) : <ActivityIndicator color={C.lime} />}
      </View>
    );
  }

  if (st.step === "review") {
    return (
      <View style={{ padding: 16, gap: 13 }}>
        {header}
        <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.deep }}>
          <T w={400} s={11.5} color={C.faint} style={{ marginBottom: 8 }}>{mode === "add" ? "Add to trading" : "Withdraw to wallet"}</T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T w={800} s={30} lh={1} ls={-0.03}>{formatAusd(st.amount)}</T>
            <T w={500} s={14} mono color={C.faint}>AUSD</T>
          </View>
        </View>
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.card, gap: 9 }}>
          <KV k="FROM" v={mode === "add" ? "Wallet" : "Trading account"} />
          <KV k="TO" v={mode === "add" ? "Trading account" : "Wallet"} />
          <KV k="NETWORK" v="Monad · gas in MON" vFg={C.dim} />
        </View>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => { setError(""); setSt({ step: "edit" }); }} disabled={busy} style={secondaryBtn}><T w={700} s={13.5}>Edit</T></Touch>
          <Touch onPress={() => { void confirm(); }} disabled={busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: busy ? 0.6 : 1 }}>
            {busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>{mode === "add" ? "Confirm deposit" : "Confirm withdrawal"}</T>}
          </Touch>
        </View>
        {mode === "add" ? <T w={400} s={11.5} lh={1.45} color={C.faint}>If the exchange allowance is too low, Pickler approves it first (one extra transaction).</T> : null}
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 13 }}>
      {header}
      <Segmented
        options={[["add", "Add funds"], ["withdraw", "Withdraw"]] as const}
        value={mode}
        onChange={(k) => { set({ fundsMode: k }); setAmount(""); }}
        tone={() => ({ bg: C.ink, fg: C.onDeep })}
      />
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.deep }}>
        <T w={400} s={11.5} color={C.faint} style={{ marginBottom: 8 }}>{mode === "add" ? "Amount to add" : "Amount to withdraw"}</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.faint} keyboardType="decimal-pad" style={[textStyle(700, 30, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]} />
          <T w={500} s={14} mono color={C.faint}>AUSD</T>
          <Touch onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} style={chipBtn}><T w={600} s={12}>Max</T></Touch>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{mode === "add" ? `Minimum ${formatAusd(minDeposit)} AUSD` : `Minimum ${formatAusd(minWithdraw)} AUSD · only free balance`}</T>
      </View>
      {!check.ok && amount !== "" ? <T w={400} s={12} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Touch onPress={() => { if (check.ok) setSt({ step: "review", amount: check.amount }); }} disabled={!check.ok} style={{ ...primaryBtn, backgroundColor: check.ok ? C.lime : C.card10 }}>
        <T w={700} s={14.5} color={check.ok ? C.onLime : C.disabled}>Review</T>
      </Touch>
      <T w={400} s={11.5} lh={1.45} color={C.faint}>Gas is paid in MON from this wallet. Locked collateral can't be withdrawn until the position closes.</T>
    </View>
  );
}

import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Hex } from "viem";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { type FundsMode, validateFunds } from "../perpl/funds";
import { Btn, Card, Chip, KVList, Page, Segmented, StatGrid, StatusCard, T, Tag, Touch, type Tone } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";

type Step = { step: "edit" } | { step: "review"; amount: bigint } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const TONES = {
  sent: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
  done: { bd: C.limeBd, bg: C.limeBg06, fg: C.lime },
  failed: { bd: C.downBd, bg: C.downBg, fg: C.down },
  unknown: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
} as const satisfies Record<string, Tone>;

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
      { label: "Wallet", value: `${formatAusd(wallet)} AUSD` },
      { label: "Trading · free", value: acc ? `${formatAusd(free)} AUSD` : perpl.lastBalance !== null ? `${formatAusd(perpl.lastBalance)} · last seen` : "—" },
    ]} />
  );

  if (st.step === "sent" || st.step === "done" || st.step === "failed" || st.step === "unknown") {
    const title = st.step === "done" ? (mode === "add" ? "Funds added" : "Withdrawn to wallet")
      : st.step === "failed" ? "Transaction reverted"
      : st.step === "unknown" ? "Sent · confirmation not received"
      : "Sent · waiting for confirmation";
    return (
      <Page gap={11}>
        {header}
        <StatusCard tag={st.step.toUpperCase()} title={title} body={st.step === "unknown" && error ? error : undefined} tone={TONES[st.step]}>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }} accessibilityLabel="tx-hash">
            <T w={400} s={10.5} lh={1.4} mono color={C.dim}>{st.hash}</T>
          </Touch>
          {st.step === "sent" ? <ActivityIndicator color={C.warn} style={{ alignSelf: "flex-start" }} /> : null}
        </StatusCard>
        {st.step !== "sent" ? <Btn label="Back to Markets" onPress={() => nav("markets")} variant="lime" py={14} accessibilityLabel="back-to-markets" /> : null}
      </Page>
    );
  }

  if (st.step === "review") {
    return (
      <Page gap={11}>
        {header}
        <Card bd={C.hair2} bg={C.deep} gap={8}>
          <Tag>{mode === "add" ? "YOU ADD TO TRADING · AUSD" : "YOU WITHDRAW TO WALLET · AUSD"}</Tag>
          <T w={700} s={30} lh={1} ls={-0.02} display>{formatAusd(st.amount)}</T>
          <KVList top rows={[
            { label: "FROM", value: mode === "add" ? "Wallet" : "Trading account" },
            { label: "TO", value: mode === "add" ? "Trading account" : "Wallet" },
            { label: "NETWORK", value: "Monad · gas in MON", fg: C.dim },
          ]} />
        </Card>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Edit" onPress={() => { setError(""); setSt({ step: "edit" }); }} variant="outline" flex={1} disabled={busy} accessibilityLabel="edit-funds" />
          <Btn label={busy ? "Sending…" : mode === "add" ? "Confirm deposit" : "Confirm withdrawal"} onPress={() => { void confirm(); }} variant="lime" flex={1} busy={busy} accessibilityLabel="confirm" />
        </View>
        {mode === "add" ? <T w={400} s={11} lh={1.45} color={C.faint}>If the exchange allowance is too low, Pickler approves it first (one extra transaction).</T> : null}
      </Page>
    );
  }

  return (
    <Page gap={11}>
      {header}
      <Segmented options={[["add", "Add funds"], ["withdraw", "Withdraw"]] as const} value={mode} onChange={(k) => { set({ fundsMode: k }); setAmount(""); }} />
      <Card bd={C.hair2} bg={C.deep} gap={6}>
        <Tag>{mode === "add" ? "AMOUNT TO ADD · AUSD" : "AMOUNT TO WITHDRAW · AUSD"}</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.faint} keyboardType="decimal-pad" accessibilityLabel="funds-input"
            style={[textStyle(700, 30, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]}
          />
          <Chip label="Max" onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} bd={C.hair22} fg={C.ink} accessibilityLabel="max" />
        </View>
        <T w={400} s={11.5} lh={1.4} color={C.dim}>{mode === "add" ? `Minimum ${formatAusd(minDeposit)} AUSD` : `Minimum ${formatAusd(minWithdraw)} AUSD · only free balance`}</T>
      </Card>
      {!check.ok && amount !== "" ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Btn label="Review" onPress={() => { if (check.ok) setSt({ step: "review", amount: check.amount }); }} arrow py={14} disabled={!check.ok} accessibilityLabel="review" />
      <T w={400} s={11} lh={1.45} color={C.faint}>Gas is paid in MON from this wallet. Locked collateral can't be withdrawn until the position closes.</T>
    </Page>
  );
}

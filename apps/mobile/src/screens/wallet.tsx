import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Address, type Hex } from "viem";
import { accountAddress } from "../account";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd, formatMon, MON_FAUCET_URL, shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import { tradingLineState } from "../store";
import { Btn, Card, Chip, KV, Page, Reveal, Skeleton, StatGrid, StatusCard, T, Tag, Touch, Warn, type Tone } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import type { Movement } from "../wallet/explorer";
import { describeError } from "../wallet/wallet";
import { validateWithdraw } from "../wallet/withdraw";

const TONES = {
  done: { bd: C.limeBd, bg: C.limeBg06, fg: C.lime },
  failed: { bd: C.downBd, bg: C.downBg, fg: C.down },
  pending: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
} as const satisfies Record<string, Tone>;

function movementDate(when: number): string {
  return new Date(when * 1000).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).toUpperCase();
}

const STATUS_FG: Record<Movement["status"], string> = { Complete: C.up, Confirming: C.warn, Reverted: C.down };

function MovementRow({ m }: { m: Movement }) {
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(m.hash)); }} accessibilityLabel={`movement-${shortHash(m.hash)}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.hair12, backgroundColor: C.card }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w={600} s={12.5} lh={1.25}>{m.kind}</T>
        <T w={500} s={9.5} lh={1} mono color={C.faint} style={{ marginTop: 3 }}>{movementDate(m.when)} · {shortHash(m.hash).toUpperCase()}</T>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <T w={700} s={12} lh={1} mono color={m.sign === "+" ? C.up : C.ink}>{m.sign === "+" ? "+" : "−"}{formatAusd(m.amount)}</T>
        <T w={500} s={9} lh={1} mono color={STATUS_FG[m.status]}>{m.status.toUpperCase()}</T>
      </View>
    </Touch>
  );
}

export function WalletScreen({ nav, account, treasury, perpl, lock, signOut, signedOut }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const available = treasury.balances ? formatAusd(treasury.balances.ausd) : "—";
  const confirming = treasury.pending.filter((m) => m.status === "Confirming").length;
  const pending = confirming === 0 ? "Nothing pending." : `${confirming} transfer${confirming === 1 ? "" : "s"} confirming`;
  const seen = new Set(treasury.pending.map((m) => m.hash));
  const rows = [...treasury.pending, ...(treasury.movements ?? []).filter((m) => !seen.has(m.hash))];
  const txHash = treasury.notice.split(": ")[1];
  const unlocked = account.status === "unlocked";
  // Wallet no está en PERPL_SCREENS: el socket nunca corre aquí, así que sin dato la línea es «—», no skeleton (C1, revisión final F1).
  const trading = tradingLineState(perpl.live, perpl.lastBalance, false);

  return (
    <Page gap={11}>
      <Card pad={15}>
        <Tag>AVAILABLE · AUSD</Tag>
        {treasury.balances === null && !treasury.rpcError
          ? <Skeleton h={30} w="45%" style={{ marginTop: 6 }} />
          : <Reveal><T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{available}</T></Reveal>}
        <T w={500} s={10} lh={1} mono color={C.faint} style={{ marginTop: 6 }}>{address ? shortHash(address) : "—"} · CONNECTED</T>
        <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 8 }}>{pending}</T>
        {perpl.state.status === "ready" ? (
          trading === "skeleton"
            ? <Skeleton h={12} w="62%" style={{ marginTop: 4 }} />
            : (
              <Reveal>
                <Touch onPress={() => nav("markets")} accessibilityLabel="in-trading">
                  <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 2 }}>
                    {trading === "unknown" ? "—" : formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)} AUSD in trading{trading === "lastSeen" ? " · last seen" : ""} · Markets
                  </T>
                </Touch>
              </Reveal>
            )
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Deposit" onPress={() => nav("deposit")} variant="outline2" flex={1} accessibilityLabel="deposit" />
        <Btn label="Withdraw" onPress={() => nav("withdraw")} variant="outline2" flex={1} accessibilityLabel="withdraw" />
      </View>

      <Tag s={10}>MOVEMENTS</Tag>
      {treasury.movementsError ? (
        <Warn title="Couldn't load movements" body={treasury.movementsError}>
          <Chip label="Retry" onPress={() => { void treasury.refreshMovements(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} />
        </Warn>
      ) : null}
      {treasury.movements === null ? treasury.pending.map((m) => <MovementRow key={m.hash} m={m} />) : null}
      {treasury.movements === null && !treasury.movementsError ? <><Skeleton.Row /><Skeleton.Row /><Skeleton.Row /></> : null}
      {treasury.movements !== null && rows.length === 0 ? <T w={400} s={12} lh={1.4} color={C.faint}>Nothing has ever arrived in this wallet.</T> : null}
      {treasury.movements !== null && rows.length > 0 ? <Reveal style={{ gap: 11 }}>{rows.map((m) => <MovementRow key={m.hash} m={m} />)}</Reveal> : null}

      <Tag s={10} style={{ marginTop: 6 }}>TESTNET</Tag>
      <Card gap={7} bg="transparent">
        <KV k="MON (GAS)" v={treasury.balances ? formatMon(treasury.balances.mon) : "—"} />
        <KV k="YOUR ADDRESS" v={address ? shortHash(address) : "—"} />
      </Card>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label={treasury.busy ? "Requesting…" : "Get test AUSD"} onPress={() => { void treasury.getTestAusd(); }} variant="lime" flex={1} busy={treasury.busy} accessibilityLabel="get-test-ausd" />
        <Btn label="Get test MON · copies address" onPress={() => { void Clipboard.setStringAsync(address).catch(() => {}); void Linking.openURL(MON_FAUCET_URL); }} variant="outline2" flex={1} s={11.5} accessibilityLabel="get-test-mon" />
      </View>
      {treasury.rpcError ? (
        <Warn title="RPC error" body={treasury.rpcError}>
          <Chip label="Retry" onPress={() => { void treasury.refresh(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} />
        </Warn>
      ) : null}
      {treasury.notice ? (
        <Touch onPress={() => { if (txHash) void Linking.openURL(EXPLORER_TX_URL(txHash)); }}>
          <T w={500} s={10.5} lh={1.4} mono color={C.up}>{treasury.notice}</T>
        </Touch>
      ) : null}
      {treasury.error ? <T w={400} s={12} lh={1.4} color={C.down}>{treasury.error}</T> : null}

      <Tag s={10} style={{ marginTop: 6 }}>SESSION</Tag>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T w={400} s={12} color={C.faint} style={{ flex: 1 }}>{unlocked ? "Unlocked" : "Locked"}</T>
        {unlocked ? <Chip label="Lock" onPress={lock} bd={C.hair22} fg={C.ink} accessibilityLabel="lock" /> : null}
        <Chip label="Sign out" onPress={() => { void signOut().then(signedOut); }} bd={C.hair22} fg={C.ink} accessibilityLabel="sign-out" />
      </View>
    </Page>
  );
}

export function DepositScreen({ nav, account }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const [copied, setCopied] = useState(false);

  return (
    <Page gap={11}>
      <StatGrid items={[{ label: "Asset", value: "AUSD" }, { label: "Network", value: "Monad" }]} />
      <View style={{ height: 150, borderWidth: 1, borderColor: C.hair22, borderStyle: "dashed", borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.card04 }}>
        <Tag>QR CODE · DEPOSIT ADDRESS</Tag>
      </View>
      <Card>
        <Tag>YOUR DEPOSIT ADDRESS</Tag>
        <T w={500} s={12} lh={1.45} mono style={{ marginTop: 6 }}>{address}</T>
      </Card>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label={copied ? "Copied" : "Copy address"} onPress={() => { void Clipboard.setStringAsync(address).then(() => setCopied(true)); }} variant="lime" flex={1} py={14} accessibilityLabel="copy-address" />
        <Btn label="I've sent it" onPress={() => nav("wallet")} variant="outline2" flex={1} py={14} />
      </View>
      <T w={400} s={11.5} lh={1.45} color={C.faint}>Only AUSD on Monad arrives here. Card and bank transfer are not assumed to exist. Gas is paid in MON.</T>
    </Page>
  );
}

type WithdrawStep = { step: "edit" } | { step: "review"; to: Address; amount: bigint; fee: bigint | null } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const inputBox = { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair, borderRadius: 12, backgroundColor: C.deep } as const;

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
    const card = st.step === "done" ? { tag: "COMPLETED", title: "Withdrawal complete", body: "The AUSD left this wallet. It shows in Movements.", tone: TONES.done }
      : st.step === "failed" ? { tag: "FAILED", title: "Withdrawal reverted", body: "Nothing left your balance.", tone: TONES.failed }
      : st.step === "unknown" ? { tag: "VERIFYING", title: "Sent · confirmation not received", body: "Check the movements list — it may still confirm.", tone: TONES.pending }
      : { tag: "SENT · WAITING ON THE NETWORK", title: "Sent · waiting for confirmation", body: "You can leave this screen.", tone: TONES.pending };
    return (
      <Page gap={12}>
        <StatusCard tag={card.tag} title={card.title} body={card.body} tone={card.tone}>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }}>
            <T w={500} s={10} lh={1.4} mono color={C.dim}>{st.hash}</T>
          </Touch>
          {st.step === "unknown" && error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        </StatusCard>
        {st.step !== "sent" ? <Btn label="Back to wallet" onPress={() => nav("wallet")} variant="lime" s={13.5} py={15} /> : <ActivityIndicator color={C.lime} />}
      </Page>
    );
  }

  if (st.step === "review") {
    return (
      <Page gap={11}>
        <Card>
          <Tag>DESTINATION ADDRESS</Tag>
          <T w={500} s={12} lh={1.45} mono style={{ marginTop: 6 }}>{st.to}</T>
        </Card>
        <Card pad={15} gap={9}>
          <Tag>YOU WITHDRAW · AUSD</Tag>
          <T w={700} s={30} lh={1} ls={-0.02} display>{formatAusd(st.amount)}</T>
          <View style={{ gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.hair12 }}>
            <KV k="NETWORK" v="MONAD" />
            <KV k="NETWORK FEE" v={st.fee !== null ? `~${formatMon(st.fee)} MON` : error ? "UNAVAILABLE" : "ESTIMATING…"} vFg={C.dim} />
            <KV k="PLATFORM FEE" v="0.00 AUSD" vFg={C.dim} />
            <KV k="YOU RECEIVE" v={`${formatAusd(st.amount)} AUSD`} vFg={C.lime} />
          </View>
        </Card>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Edit" onPress={() => { setError(""); setSt({ step: "edit" }); }} variant="outline2" disabled={busy} style={{ width: 96 }} py={14} />
          <Btn label={busy ? "Confirming…" : "Confirm withdrawal"} onPress={() => { void confirm(); }} variant="lime" flex={1} busy={busy} s={13.5} py={14} accessibilityLabel="confirm-withdrawal" />
        </View>
        <T w={400} s={11.5} lh={1.45} color={C.faint}>Gas is paid in MON from this wallet. The AUSD amount arrives in full.</T>
      </Page>
    );
  }

  return (
    <Page gap={11}>
      <View style={inputBox}>
        <Tag>DESTINATION ADDRESS</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Paste a Monad address"
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={[textStyle(500, 12.5, { mono: true, color: C.ink }), { flex: 1, paddingVertical: 6 }]}
          />
          <Chip label="Paste" onPress={() => { void Clipboard.getStringAsync().then((s) => setTo(s.trim())).catch(() => {}); }} bd={C.hair22} fg={C.ink} />
        </View>
      </View>
      <Card pad={15} gap={9}>
        <Tag>AMOUNT · AUSD</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C.faint}
            keyboardType="decimal-pad"
            style={[textStyle(700, 30, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, paddingVertical: 4 }]}
          />
          <Chip label="MAX" mono s={10} py={6} px={10} onPress={() => setAmount(formatUnits(ausd, AUSD_DECIMALS))} />
        </View>
        <T w={500} s={9.5} lh={1} ls={0.06} mono color={C.faint}>AVAILABLE {formatAusd(ausd)} AUSD</T>
      </Card>
      {!check.ok && (to !== "" || amount !== "") ? <T w={400} s={12} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Btn label="Review withdrawal" onPress={() => { void review(); }} disabled={!check.ok} variant="lime" arrow s={13} py={15} accessibilityLabel="review-withdrawal" />
      <T w={400} s={11.5} lh={1.45} color={C.faint}>Only AUSD on Monad. Gas is paid in MON from this wallet.</T>
    </Page>
  );
}

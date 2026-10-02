import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { formatUnits, type Address, type Hex } from "viem";
import { accountAddress } from "../account";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd, formatMon, MON_FAUCET_URL, shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import { tradingLineState } from "../store";
import { Btn, Card, Chip, InkBlock, InkTile, KV, Page, Reveal, Segmented, Skeleton, StatGrid, StatusCard, T, Tag, Touch, Warn, type Tone } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import type { Movement } from "../wallet/explorer";
import { splitMovements } from "../wallet/movements";
import { describeError } from "../wallet/wallet";
import { validateWithdraw } from "../wallet/withdraw";

const TONES = {
  done: { bd: C.limeBd, bg: C.limeBg06, fg: C.limeInk },
  failed: { bd: C.downBd, bg: C.downBg, fg: C.down },
  pending: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
} as const satisfies Record<string, Tone>;

function movementDate(when: number): string {
  return new Date(when * 1000).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).toUpperCase();
}

function MovementRow({ m }: { m: Movement }) {
  const dot = m.status === "Confirming" ? C.pending : m.sign === "+" ? C.lime : C.vio;
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(m.hash)); }} accessibilityLabel={`movement-${shortHash(m.hash)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.card }}>
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dot }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w={600} s={14} lh={1.25}>{m.kind}</T>
        <T w={500} s={10} lh={1} mono color={C.faint} style={{ marginTop: 4 }}>{movementDate(m.when)} · {m.status.toUpperCase()}</T>
      </View>
      <T w={700} s={13} lh={1} mono color={m.status === "Reverted" ? C.faint : m.sign === "+" ? C.up : C.ink}>{m.sign === "+" ? "+" : "−"}{formatAusd(m.amount)}</T>
    </Touch>
  );
}

export function WalletScreen({ nav, account, treasury, perpl, identity, lock, signOut, signedOut }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const available = treasury.balances ? formatAusd(treasury.balances.ausd) : "—";
  const confirming = treasury.pending.filter((m) => m.status === "Confirming").length;
  const seen = new Set(treasury.pending.map((m) => m.hash));
  const rows = [...treasury.pending, ...(treasury.movements ?? []).filter((m) => !seen.has(m.hash))];
  const txHash = treasury.notice.split(": ")[1];
  const unlocked = account.status === "unlocked";
  // Wallet no está en PERPL_SCREENS: el socket nunca corre aquí, así que sin dato la línea es «—», no skeleton (C1, revisión final F1).
  const trading = tradingLineState(perpl.live, perpl.lastBalance, false);
  const [tab, setTab] = useState<"activity" | "pending">("activity");
  const { activity, pending: pendingRows } = splitMovements(rows);

  return (
    <Page gap={14}>
      <InkBlock gap={14}>
        <Tag color={C.onInkDim}>AVAILABLE · AUSD</Tag>
        {treasury.balances === null && !treasury.rpcError
          ? <Skeleton h={44} w="55%" />
          : <Reveal><T w={700} s={44} lh={1} ls={-0.03} mono color={C.onInk}>{available}</T></Reveal>}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Deposit" icon="down" onPress={() => nav("deposit")} variant="lime" flex={1} accessibilityLabel="deposit" />
          <Btn label="Withdraw" icon="up" onPress={() => nav("withdraw")} variant="tile" flex={1} accessibilityLabel="withdraw" />
        </View>
        {perpl.state.status === "ready" ? (
          <Touch onPress={() => nav("perpsFunds", { fundsMode: "add" })} accessibilityLabel="in-trading">
            <InkTile style={{ flex: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Tag color={C.onInkDim}>IN TRADING · AUSD</Tag>
              {trading === "skeleton" ? <Skeleton h={14} w={80} /> : (
                <T w={700} s={15} lh={1} mono color={C.onInk}>
                  {trading === "unknown" ? "—" : formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)}{trading === "lastSeen" ? " · last seen" : ""}
                </T>
              )}
            </InkTile>
          </Touch>
        ) : null}
      </InkBlock>

      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T w={600} s={15} lh={1.2}>Monad testnet</T>
          <T w={500} s={11} lh={1.2} mono color={C.faint} style={{ marginTop: 3 }}>{address ? shortHash(address) : "—"}</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.up }} />
          <Tag color={C.up}>CONNECTED</Tag>
        </View>
      </Card>

      <Segmented options={[["activity", "Activity"], ["pending", `Pending${confirming ? ` · ${confirming}` : ""}`]] as const} value={tab} onChange={setTab} />
      {treasury.movementsError ? (
        <Warn title="Couldn't load movements" body={treasury.movementsError}>
          <Chip label="Retry" onPress={() => { void treasury.refreshMovements(); }} style={{ alignSelf: "flex-start" }} />
        </Warn>
      ) : null}
      {tab === "pending" ? (
        pendingRows.length === 0 ? <T w={400} s={13} lh={1.4} color={C.faint}>Nothing pending.</T> : <View style={{ gap: 8 }}>{pendingRows.map((m) => <MovementRow key={m.hash} m={m} />)}</View>
      ) : treasury.movements === null && !treasury.movementsError ? (
        <><Skeleton.Row /><Skeleton.Row /><Skeleton.Row /></>
      ) : activity.length === 0 ? (
        <T w={400} s={13} lh={1.4} color={C.faint}>Nothing has ever arrived in this wallet.</T>
      ) : (
        <Reveal style={{ gap: 8 }}>{activity.map((m) => <MovementRow key={m.hash} m={m} />)}</Reveal>
      )}
      <T w={400} s={12} lh={1.45} color={C.faint}>Withdrawals always ask for Face ID.</T>

      <Tag s={10} style={{ marginTop: 6 }}>TESTNET</Tag>
      <Card gap={7}>
        <KV k="MON (GAS)" v={treasury.balances ? formatMon(treasury.balances.mon) : "—"} />
        <KV k="YOUR ADDRESS" v={address ? shortHash(address) : "—"} />
      </Card>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label={treasury.busy ? "Requesting…" : "Get test AUSD"} onPress={() => { void treasury.getTestAusd(); }} variant="lime" flex={1} busy={treasury.busy} accessibilityLabel="get-test-ausd" />
        <Btn label="Get test MON · copies address" onPress={() => { void Clipboard.setStringAsync(address).catch(() => {}); void Linking.openURL(MON_FAUCET_URL); }} variant="outline2" flex={1} s={11.5} accessibilityLabel="get-test-mon" />
      </View>
      {treasury.rpcError ? (
        <Warn title="RPC error" body={treasury.rpcError}>
          <Chip label="Retry" onPress={() => { void treasury.refresh(); }} style={{ alignSelf: "flex-start" }} />
        </Warn>
      ) : null}
      {treasury.notice ? (
        <Touch onPress={() => { if (txHash) void Linking.openURL(EXPLORER_TX_URL(txHash)); }}>
          <T w={500} s={10.5} lh={1.4} mono color={C.up}>{treasury.notice}</T>
        </Touch>
      ) : null}
      {treasury.error ? <T w={400} s={12} lh={1.4} color={C.down}>{treasury.error}</T> : null}

      {identity.identity.status === "has" ? (
        <>
          <Tag s={10} style={{ marginTop: 6 }}>ACCOUNT</Tag>
          <KV k="USERNAME" v={`@${identity.identity.handle}`} />
        </>
      ) : null}
      <Tag s={10} style={{ marginTop: 6 }}>SESSION</Tag>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T w={400} s={12} color={C.faint} style={{ flex: 1 }}>{unlocked ? "Unlocked" : "Locked"}</T>
        {unlocked ? <Chip label="Lock" onPress={lock} accessibilityLabel="lock" /> : null}
        <Chip label="Sign out" onPress={() => { void signOut().then(signedOut); }} accessibilityLabel="sign-out" />
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
      <View style={{ alignSelf: "center", padding: 16, borderRadius: 22, backgroundColor: C.bg, borderWidth: 1, borderColor: C.hair08 }}>
        {address ? <QRCode value={address} size={180} color={C.ink} backgroundColor={C.bg} /> : <Skeleton h={180} w={180} />}
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

const inputBox = { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.card } as const;

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
        {st.step !== "sent" ? <Btn label="Back to wallet" onPress={() => nav("wallet")} variant="lime" s={13.5} py={15} /> : <ActivityIndicator color={C.limeInk} />}
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
          <T w={700} s={30} lh={1} ls={-0.02} mono>{formatAusd(st.amount)}</T>
          <View style={{ gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.hair12 }}>
            <KV k="NETWORK" v="MONAD" />
            <KV k="NETWORK FEE" v={st.fee !== null ? `~${formatMon(st.fee)} MON` : error ? "UNAVAILABLE" : "ESTIMATING…"} vFg={C.dim} />
            <KV k="PLATFORM FEE" v="0.00 AUSD" vFg={C.dim} />
            <KV k="YOU RECEIVE" v={`${formatAusd(st.amount)} AUSD`} vFg={C.limeInk} />
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
            style={[textStyle(700, 30, { lh: 1.3, ls: -0.02, mono: true, color: C.ink }), { flex: 1, paddingVertical: 4 }]}
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

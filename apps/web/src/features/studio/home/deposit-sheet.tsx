"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Icon, Segmented } from "@pickler/ui";
import { SessionExpired } from "@/features/auth/lib/custody";
import { depositConfirm, depositPrepare, errorCode, saveLimits, type Agent } from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";
import { depositFailure } from "./status";
import styles from "./home.module.css";

const AMOUNTS = ["10", "25", "50", "100"] as const;
type Amount = (typeof AMOUNTS)[number];

/** The canvas's starting limits when the person has not set any. Shown, and saved only on a change. */
const DEFAULT_LIMITS = { perCallAusd: 5, perDayAusd: 20 };
/** `spendLimitsSchema`'s ceilings, restated so the + buttons stop where the API would refuse. */
const MAX_PER_CALL = 1_000;
const MAX_PER_DAY = 10_000;
const SAVE_DELAY_MS = 700;

/** The two names a WebAuthn prompt fails with when the person closed it or it timed out. */
const CLOSED_PROMPT = new Set(["NotAllowedError", "AbortError"]);

type LimitsState = "idle" | "saving" | "saved";

/**
 * The deposit sheet under the wallet: 10 / 25 / 50 / 100 AUSD, the two spend limits (stored, shown,
 * not enforced yet), and "Deposit N AUSD · confirm with passkey" — prepare, a passkey stamp of the
 * exact body the API built, confirm. A confirm the API already recorded counts as done.
 */
export function DepositSheet({
  agent,
  preview,
  canManage,
  onDeposited,
}: {
  agent: Agent;
  preview: boolean;
  canManage: boolean;
  /** Called with the transaction hash, or null when a repeated confirm was already recorded. */
  onDeposited(txHash: string | null): void;
}) {
  const agentId = agent.productId ?? agent.id;
  const [amount, setAmount] = useState<Amount>("25");
  const [limits, setLimits] = useState(agent.spend ?? DEFAULT_LIMITS);
  const [limitsState, setLimitsState] = useState<LimitsState>("idle");
  const [limitsError, setLimitsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rpId = useRef<Promise<string> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(saveTimer.current);
    };
  }, []);

  /* The relying party comes from a custody challenge, fetched as the sheet opens so the click that
     deposits reaches the passkey prompt with one fetch fewer in between. */
  useEffect(() => {
    if (preview || !canManage) {
      return;
    }
    const pending = relyingParty();
    // A failure here is reported when the person deposits, where it can be acted on.
    pending.catch(() => {});
    rpId.current = pending;
  }, [preview, canManage]);

  function changeLimits(next: { perCallAusd: number; perDayAusd: number }) {
    setLimits(next);
    setLimitsError("");
    if (preview) {
      return;
    }
    clearTimeout(saveTimer.current);
    setLimitsState("saving");
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          await saveLimits(agentId, next.perCallAusd, next.perDayAusd);
          if (mounted.current) {
            setLimitsState("saved");
          }
        } catch (caught) {
          if (mounted.current) {
            setLimitsState("idle");
            setLimitsError(caught instanceof Error ? caught.message : "The limits were not saved.");
          }
        }
      })();
    }, SAVE_DELAY_MS);
  }

  async function deposit() {
    const value = Number(amount);
    setBusy(true);
    setError("");
    try {
      const rp = await (rpId.current ?? relyingParty());
      const unsigned = await depositPrepare(agentId, value);
      const signed = await stampActivity(rp, unsigned);
      const { txHash } = await depositConfirm(agentId, value, signed);
      onDeposited(txHash);
    } catch (caught) {
      if (caught instanceof Error && CLOSED_PROMPT.has(caught.name)) {
        setError("The passkey prompt was closed. Nothing was sent.");
      } else if (caught instanceof SessionExpired) {
        setError("Your sign-in expired. Sign in again; nothing was sent.");
      } else {
        const failure = depositFailure(
          errorCode(caught),
          caught instanceof Error ? caught.message : "The deposit did not go through.",
        );
        if (failure.done) {
          onDeposited(null);
        } else {
          rpId.current = null;
          setError(failure.message);
        }
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  /** The canvas's steppers: a call by 1, a day by 5, a call never above a day. */
  function step(row: "call" | "day", direction: 1 | -1) {
    if (row === "call") {
      const perCallAusd =
        direction > 0
          ? Math.min(limits.perDayAusd, MAX_PER_CALL, limits.perCallAusd + 1)
          : Math.max(1, limits.perCallAusd - 1);
      changeLimits({ ...limits, perCallAusd });
      return;
    }
    const perDayAusd =
      direction > 0
        ? Math.min(MAX_PER_DAY, limits.perDayAusd + 5)
        : Math.max(limits.perCallAusd, limits.perDayAusd - 5);
    changeLimits({ ...limits, perDayAusd });
  }

  const rows = [
    { key: "call" as const, title: "Max per call", value: limits.perCallAusd },
    { key: "day" as const, title: "Max a day", value: limits.perDayAusd },
  ];
  const locked = preview || !canManage;
  const limitsNote =
    limitsState === "saving"
      ? "Saving…"
      : limitsState === "saved"
        ? "Saved. Applies when it trades for real."
        : agent.spend
          ? "Applies when it trades for real."
          : "Not set yet. Applies when it trades for real.";

  return (
    <div className={styles.sheet} id="home-deposit">
      <Segmented
        label="Amount in AUSD"
        tone="lime"
        className={styles.amounts}
        options={AMOUNTS.map((value) => ({ value, label: value }))}
        value={amount}
        onChange={setAmount}
      />
      {rows.map((row) => (
        <div key={row.key} className={styles.limitRow}>
          <span className={styles.limitTitle}>{row.title}</span>
          <Button
            variant="secondary"
            size="sm"
            className={styles.stepper}
            aria-label={`Lower ${row.title.toLowerCase()}`}
            disabled={locked}
            onClick={() => step(row.key, -1)}
          >
            −
          </Button>
          <span className={styles.limitValue}>{row.value} AUSD</span>
          <Button
            variant="secondary"
            size="sm"
            className={styles.stepper}
            aria-label={`Raise ${row.title.toLowerCase()}`}
            disabled={locked}
            onClick={() => step(row.key, 1)}
          >
            +
          </Button>
        </div>
      ))}
      <p className={styles.fine} aria-live="polite">
        {limitsNote}
      </p>
      {limitsError && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          {limitsError}
        </p>
      )}
      <Button block disabled={locked || busy} onClick={() => void deposit()}>
        {busy ? "Waiting for your passkey…" : `Deposit ${amount} AUSD · confirm with passkey`}
      </Button>
      {error && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}
      <p className={styles.fine}>
        Or send AUSD on Monad to the address above. It can never withdraw on its own.
      </p>
      {preview && <p className={styles.fine}>Design preview: nothing here can be sent or saved.</p>}
    </div>
  );
}

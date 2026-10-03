/**
 * The draft studio's Run and YOU rules (studio-draft-dashboard-v1 §3.4, D12, D13, D17): the
 * schedule's choices and next runs, the Console's inputs, and Master wallet's allocation as the
 * draft canvas draws it. The ledger both studios share is `../shell/wallet-model.ts`'s. Pure, no
 * React and no transport, pinned in `apps/web/test/studio-draft-model.test.ts`.
 */
import type { WalletsDto } from "@pickler/api-schema";
import { formatUnits, shortAddress, unitsOf } from "../new-agent/model";
import { clock, dayNumber } from "../shell/clock";
import type { AllocationRow } from "../shell/wallet-model";

/** The schedule's choices (spec D13), not the canvas's 1 / 6 / 12 / 24. */
export const INTERVAL_OPTIONS = [3, 6, 12, 24] as const;

export const runsPerDay = (intervalHours: number): number =>
  Math.max(1, Math.round(24 / intervalHours));

/**
 * The next three runs, an interval apart from `now`, in local time: "TMRW" the next calendar day,
 * "+nD" beyond it (the canvas says TMRW for any other day). The first says runs are not open yet
 * (D19): the schedule starts with the Perpl runtime, not when it goes public. Like every clock in
 * the draft studio, the view marks both the label and the time `suppressHydrationWarning`.
 */
export function nextRuns(intervalHours: number, now: Date): { label: string; at: string }[] {
  return [1, 2, 3].map((n) => {
    const at = new Date(now.getTime() + n * intervalHours * 3_600_000);
    const days = dayNumber(at) - dayNumber(now);
    let suffix = "";
    if (days === 1) {
      suffix = " · TMRW";
    } else if (days > 1) {
      suffix = ` · +${days}D`;
    }
    return {
      label: n === 1 ? "First run once runs open" : "Then · reads sources, decides, posts",
      at: `${clock(at)}${suffix}`,
    };
  });
}

export interface RunInput {
  key: "perpl" | "web";
  label: string;
}

/**
 * The Console's "inputs it reads" chips (spec §3.4): Perpl always, and the web when it is on, with
 * its mode, "ANYWHERE" or the sites it keeps to. The canvas's brief, caps and voice chips are left
 * out: they say what it would do on a run, and runs are not open yet (D12).
 */
export function runInputs(
  web: { mode: "anywhere" | "prefer" | "only"; sites: readonly string[] } | null | undefined,
): RunInput[] {
  const inputs: RunInput[] = [{ key: "perpl", label: "Perpl" }];
  if (web) {
    const count = web.sites.length;
    const where =
      web.mode === "anywhere" ? "ANYWHERE" : `${count} ${count === 1 ? "SITE" : "SITES"}`;
    inputs.push({ key: "web", label: `Web · ${where}` });
  }
  return inputs;
}

/**
 * Master wallet's allocation (spec D17): what is free in master and what each agent wallet holds,
 * read from `GET /wallets` (a plain dash until then, or for a wallet the chain did not answer
 * for), then the person's positions and AI credits, both Soon.
 */
export function allocationRows(wallets: WalletsDto | null): AllocationRow[] {
  const masterAusd = wallets ? unitsOf(wallets.master.ausdMicro) : null;
  const rows: AllocationRow[] = [
    {
      key: "master",
      label: "Free in master",
      value: masterAusd === null ? "—" : `${formatUnits(masterAusd, "AUSD")} AUSD`,
      kind: "master",
      soon: false,
    },
  ];
  for (const wallet of wallets?.agents ?? []) {
    const ausd = unitsOf(wallet.ausdMicro);
    const mon = unitsOf(wallet.monWei);
    rows.push({
      key: wallet.walletId,
      label: wallet.agentName
        ? `${wallet.agentName}'s wallet`
        : `Agent wallet · ${shortAddress(wallet.address)}`,
      value:
        ausd === null || mon === null
          ? "—"
          : `${formatUnits(ausd, "AUSD")} AUSD · ${formatUnits(mon, "MON")} MON`,
      kind: "agent",
      soon: false,
    });
  }
  rows.push(
    {
      key: "positions",
      label: "Your open positions",
      value: "Soon",
      kind: "positions",
      soon: true,
    },
    { key: "credits", label: "AI credits", value: "Soon", kind: "credits", soon: true },
  );
  return rows;
}

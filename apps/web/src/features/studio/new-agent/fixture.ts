import type { StudioWallets } from "../api";
import type { CreateStage } from "../home/stage";
import { emptyForm, type NewAgentForm, type WalletView } from "./model";
import type { SheetPhase } from "./passkey-sheet";

/** The create screen filled in for the design harness, at one moment. Nothing is sent. */
export interface NewAgentStaged {
  form: NewAgentForm;
  accessStatus?: "not_requested" | "pending" | undefined;
  accessLoading?: boolean;
  available: boolean;
  wallet: WalletView | null;
  firstTime: boolean;
  wallets: StudioWallets;
  advancedOpen: boolean;
  modal: null | "wallets" | "credits" | "avatar";
  /** The Wallets modal opens with this agent wallet's transfer showing. */
  fundOn: string | null;
  sheet: null | { kind: "create" | "wallet"; phase: SheetPhase; step: 1 | 2 };
}

const ADDRESS = "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07";
const MASTER = "0x7f3a9C41e02bB7d5F8a16E3c90D4b27A51f0c21e";
const WALLET_ID = "wal-preview";

/** The create sheet's phase on each sheet stage: Continue, the Touch ID wait, done, cancelled. */
const SHEET_PHASES: Partial<Record<CreateStage, SheetPhase>> = {
  "create-sheet": "idle",
  "create-sheet-busy": "busy",
  "create-sheet-ok": "ok",
  "create-sheet-cancelled": "err",
};

/** The wallet sheet, a first wallet's two signatures: the wallet itself, then Pickler's user. */
const WALLET_SHEET_STEPS: Partial<Record<CreateStage, 1 | 2>> = {
  "create-wallet-sheet": 1,
  "create-wallet-sheet-step2": 2,
};

const MODALS: Partial<Record<CreateStage, NonNullable<NewAgentStaged["modal"]>>> = {
  "create-wallets": "wallets",
  "create-credits": "credits",
  "create-avatar": "avatar",
};

/**
 * The create screen at one `?stage=create-*` (`home/stage.ts`), as the "Pickler Studio Empty v5"
 * canvas draws it: Halftime, an analyst, with its wallet empty on `create-wallet` and holding
 * 25 AUSD and 0.5 MON from `create-funded` on. `create-empty` is a first visit with nothing typed.
 * The wallet sheet is a first wallet's: no wallet on step 1, and on step 2 the wallet step 1 made,
 * still empty, waiting for Pickler's delegated user.
 */
export function newAgentFixture(stage: CreateStage): NewAgentStaged {
  const blank =
    stage === "create-empty" ||
    stage === "create-access" ||
    stage === "create-access-pending" ||
    stage === "create-access-loading";
  const walletStep = WALLET_SHEET_STEPS[stage];
  const noWallet = blank || walletStep === 1;
  const funded = !noWallet && stage !== "create-wallet" && walletStep !== 2;
  const form: NewAgentForm = blank
    ? emptyForm()
    : {
        ...emptyForm(),
        name: "Halftime",
        voice: "analyst",
        ...(stage === "create-web"
          ? { webOn: true, webMode: "prefer", sites: ["coindesk.com", "theblock.co", "x.com"] }
          : {}),
      };
  const wallet: WalletView | null = noWallet
    ? null
    : {
        walletId: WALLET_ID,
        address: ADDRESS,
        ausdMicro: funded ? 25_000_000n : 0n,
        monWei: funded ? 500_000_000_000_000_000n : 0n,
      };
  const phase = SHEET_PHASES[stage];
  const modal = MODALS[stage] ?? null;

  return {
    form,
    accessStatus:
      stage === "create-access" || stage === "create-access-loading"
        ? "not_requested"
        : stage === "create-access-pending"
          ? "pending"
          : undefined,
    accessLoading: stage === "create-access-loading",
    available: true,
    wallet,
    firstTime: blank || walletStep !== undefined,
    advancedOpen: stage === "create-advanced",
    modal,
    fundOn: modal === "wallets" ? WALLET_ID : null,
    sheet: walletStep
      ? { kind: "wallet", phase: "idle", step: walletStep }
      : phase
        ? { kind: "create", phase, step: 1 }
        : null,
    wallets: {
      master: { address: MASTER, ausdMicro: "187600000", monWei: "4200000000000000000" },
      agents: wallet
        ? [
            {
              walletId: wallet.walletId,
              address: ADDRESS,
              agentId: null,
              agentName: null,
              caps: null,
              policiesApproved: false,
              ausdMicro: String(wallet.ausdMicro),
              monWei: String(wallet.monWei),
            },
          ]
        : [],
      readAt: 0,
    },
  };
}

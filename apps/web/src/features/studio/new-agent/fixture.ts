import type { StudioWallets } from "../api";
import type { NewAgentForm, WalletView } from "./model";

/**
 * The create screen filled in for the design harness, at one moment. Nothing is sent. Task 11 adds
 * `newAgentFixture(stage)`, which builds one per create stage.
 */
export interface NewAgentStaged {
  form: NewAgentForm;
  available: boolean;
  wallet: WalletView | null;
  firstTime: boolean;
  wallets: StudioWallets;
  advancedOpen: boolean;
  modal: null | "wallets" | "credits" | "avatar";
  sheet: null | "create";
}

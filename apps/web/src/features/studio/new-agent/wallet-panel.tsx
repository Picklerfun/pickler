"use client";
import type { NewAgentForm, WalletView } from "./model";

export interface WalletPanelProps {
  wallet: WalletView | null;
  /** No delegated user yet: creating the wallet is two signatures. */
  firstTime: boolean;
  /**
   * The wallet exists but Pickler's delegated user does not (step 2 was cancelled): `wallet` is
   * null, and "Create its wallet" is step 2 only.
   */
  pendingDelegate: boolean;
  form: NewAgentForm;
  checkedAt: string;
  arrivals: { text: string; at: string }[];
  busy: boolean;
  preview: boolean;
  onCreateWallet(): void;
  onRefresh(): void;
  onFund(): void;
}

/** "Its wallet". A placeholder until Task 7 draws the panel; the screen wires it already. */
export function WalletPanel(props: WalletPanelProps): null {
  void props;
  return null;
}

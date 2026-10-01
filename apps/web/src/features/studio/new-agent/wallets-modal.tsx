"use client";
import type { StudioWallets } from "../api";

export interface WalletsModalProps {
  open: boolean;
  wallets: StudioWallets | null;
  /** Open with this agent wallet's move form showing, toward the agent. */
  openOn: string | null;
  preview: boolean;
  onClose(): void;
  onMoved(): void;
}

/** "Your wallets". A placeholder until Task 8 draws it; the screen wires it already. */
export function WalletsModal(props: WalletsModalProps): null {
  void props;
  return null;
}

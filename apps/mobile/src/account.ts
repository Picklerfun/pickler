import type { EvmAddress } from "@category-labs/mera";
import type { Wallet } from "./wallet/wallet";

export type AccountState =
  | { status: "none" }
  | { status: "locked"; address: EvmAddress; credentialId: string }
  | { status: "unlocked"; wallet: Wallet };

export function accountAddress(account: AccountState): EvmAddress | null {
  switch (account.status) {
    case "none":
      return null;
    case "locked":
      return account.address;
    case "unlocked":
      return account.wallet.address;
  }
}

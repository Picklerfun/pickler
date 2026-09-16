import type { EvmAddress } from "@category-labs/mera";

export type Wallet = {
  address: EvmAddress;
  credentialId: string;
  session: { end(): void };
};

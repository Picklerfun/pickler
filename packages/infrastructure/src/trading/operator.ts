import { createSecureClient } from "@polymarket/client";
import { builderApiKey } from "@polymarket/client/node";
import { privateKey } from "@polymarket/client/viem";
import { privateKeyToAccount } from "viem/accounts";
import { saveTradingCredentials } from "./wallet-file.js";

/** Explicit operator command only. This may deploy an account; never import into startup hooks. */
export async function setupTradingAccount(input: {
  path: string;
  privateKey: string;
  signer: string;
  builderKey: string;
  builderSecret: string;
  builderPassphrase: string;
  wallet?: string;
  approve?: boolean;
}) {
  const account = privateKeyToAccount(input.privateKey as `0x${string}`);
  if (account.address.toLowerCase() !== input.signer.toLowerCase()) {
    throw new Error("Invalid signer configuration");
  }
  const client = await createSecureClient({
    signer: privateKey(input.privateKey),
    ...(input.wallet ? { wallet: input.wallet } : {}),
    apiKey: builderApiKey({
      key: input.builderKey,
      secret: input.builderSecret,
      passphrase: input.builderPassphrase,
    }),
  });
  await saveTradingCredentials(input.path, {
    POLYMARKET_WALLET_ADDRESS: client.account.wallet,
    POLYMARKET_CLOB_API_KEY: client.credentials.key,
    POLYMARKET_CLOB_API_SECRET: client.credentials.secret,
    POLYMARKET_CLOB_API_PASSPHRASE: client.credentials.passphrase,
  });
  if (input.approve) {
    await client.setupTradingApprovals();
  }
  return { wallet: client.account.wallet, signer: client.account.signer };
}
